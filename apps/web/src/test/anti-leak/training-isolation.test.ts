import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { weeklySnapshotSchema } from '@/lib/schemas/weekly-report';
import { computeEngagementScore, type EngagementCheckinInput } from '@/lib/scoring/engagement';
import { parseTriggerRule } from '@/lib/triggers/schema';
import { evalNoTrainingActivityInWindow } from '@/lib/triggers/evaluators';
import type { TriggerContext } from '@/lib/triggers/types';
import { buildWeeklySnapshot } from '@/lib/weekly-report/builder';
import type { BuilderInput } from '@/lib/weekly-report/types';

/**
 * SPEC §21.5 — BLOCKING statistical-isolation suite (J-T4, the final
 * sub-jalon's central deliverable).
 *
 * Invariant under test: a `TrainingTrade` (backtest) — and in particular its
 * P&L (`resultR` / `outcome` / `plannedRR`) — NEVER reaches a real-edge
 * surface (journal, dashboard, 4-dim score, expectancy, Habit×Trade
 * correlation). Training EFFORT (a count / recency) feeds exactly three
 * sanctioned touchpoints through ONE audited primitive
 * (`countRecentTrainingActivity`, which selects only a count + `enteredAt`):
 *
 *   1. engagement scoring        — `lib/scoring/service.ts`
 *   2. inactivity Douglas trigger — `lib/triggers/engine.ts`
 *   3. weekly-report volume line  — `lib/weekly-report/loader.ts`
 *
 * Any other real-edge module importing the training module, referencing
 * `db.trainingTrade`, or naming the `TrainingTrade` model is a breach. This
 * suite proves the firewall both structurally (source grep) and behaviourally
 * (the count is the ONLY channel; P&L cannot move the needle).
 */

// Resolve repo source relative to THIS test file (cwd-independent).
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

/**
 * The firewall enforces "no real CODE dependency on the training module".
 * Defensive `// 🚨 §21.5 …` comments deliberately *name* the forbidden
 * pattern (e.g. "never `db.trainingTrade`") as documentation — those are
 * desirable, not breaches. Strip comments before the token grep so the
 * invariant means what it should. (Block + line comments; the `:` guard
 * avoids truncating a `://` inside a code string — irrelevant to our
 * identifier/path tokens but robust.)
 */
function readSrcCode(rel: string): string {
  return readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The 4 deliberate touchpoints — may import ONLY the count-only primitive.
 *  V1.4 J-M2 added `lib/monthly-debrief/loader.ts` (SPEC §25.3 — the monthly
 *  debrief's training slice is sourced EXCLUSIVELY from the same audited
 *  primitive, exactly like `weekly-report/loader.ts`). It is NOT under a
 *  globbed real-edge tree, so Block A pins its import contract here. */
const SANCTIONED_TOUCHPOINTS = [
  'lib/scoring/service.ts',
  'lib/triggers/engine.ts',
  'lib/weekly-report/loader.ts',
  'lib/monthly-debrief/loader.ts',
] as const;

/**
 * Real-edge modules that must have ZERO code dependency on the training
 * module. Discovered by DIRECTORY GLOB (not a hardcoded list) so that ANY
 * future file added under these real-edge trees is covered by the firewall
 * by default — closing the security-auditor's coverage-fragility finding
 * (a hardcoded allowlist silently misses new modules). `engagement.ts` is
 * covered on purpose: it gained an integer `trainingActivityCount` param
 * but must still carry no training-module import and no `TrainingTrade`
 * reference (the precise token is `TrainingTrade` / `db.trainingTrade` /
 * the import path — NOT the substring "training", a legit param name).
 *
 * The 3 sanctioned touchpoints are filtered out (only `scoring/service.ts`
 * actually falls under a globbed tree; `triggers/engine.ts` and
 * `weekly-report/loader.ts` are outside these dirs and are asserted
 * separately below).
 */
function tsFilesIn(relDir: string): string[] {
  const abs = fileURLToPath(new URL(`../../${relDir}`, import.meta.url));
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
    .map((f) => `${relDir}/${f}`);
}

const REAL_EDGE_MODULES: string[] = [
  ...tsFilesIn('lib/scoring'),
  ...tsFilesIn('lib/analytics'),
  ...tsFilesIn('lib/trades'),
  ...tsFilesIn('lib/habit'),
  'lib/weekly-report/builder.ts',
].filter((f) => !(SANCTIONED_TOUCHPOINTS as readonly string[]).includes(f));

// A real-edge file may NOT contain any of these (case-sensitive). They catch
// the Prisma models (`TrainingTrade` / `TrainingDebrief`), their serializers,
// a `db.trainingTrade` / `db.trainingDebrief` query, or an import of either
// training module. `@/lib/training-debrief` is a superstring of the existing
// `@/lib/training` token (so already caught) — listed for explicit intent.
const BREACH_TOKENS = [
  'TrainingTrade',
  'db.trainingTrade',
  '@/lib/training',
  // V1.3 — SPEC §23 Débrief Training dédié. The debrief + its computed stats
  // must never reach a real-edge surface (§21.5, §23.5/§23.7 BLOCKING).
  'TrainingDebrief',
  'db.trainingDebrief',
  '@/lib/training-debrief',
  // V1.4 — SPEC §25 Débrief Mensuel IA. The monthly debrief + its snapshot
  // must never reach a real-edge surface — §21.5/§25.7 BLOCKING: "l'edge
  // réel ne reçoit JAMAIS rien du débrief". (`@/lib/monthly-debrief` is a
  // distinct path from `@/lib/schemas/monthly-debrief`; listing the model +
  // db accessor catches a real-edge import of either, mirror §23.)
  'MonthlyDebrief',
  'db.monthlyDebrief',
  '@/lib/monthly-debrief',
];

// =============================================================================
// Block A — static import firewall (the structural §21.5 proof)
// =============================================================================

describe('§21.5 — static import firewall', () => {
  it('the real-edge glob actually discovers the trees (no silent empty set)', () => {
    // A bad glob path makes readdirSync throw (loud) — this also pins a
    // coverage floor + the critical surfaces so a future refactor cannot
    // quietly shrink the firewall to a false pass.
    expect(REAL_EDGE_MODULES.length).toBeGreaterThanOrEqual(20);
    for (const critical of [
      'lib/scoring/engagement.ts',
      'lib/scoring/dashboard-data.ts',
      'lib/analytics/expectancy.ts',
      'lib/analytics/habit-trade-correlation.ts',
      'lib/trades/service.ts',
      'lib/habit/service.ts',
      'lib/weekly-report/builder.ts',
    ]) {
      expect(REAL_EDGE_MODULES).toContain(critical);
    }
    // The sanctioned touchpoints must NOT be in the real-edge scan.
    for (const s of SANCTIONED_TOUCHPOINTS) {
      expect(REAL_EDGE_MODULES).not.toContain(s);
    }
  });

  it.each(REAL_EDGE_MODULES)('real-edge module %s has zero training dependency', (rel) => {
    const code = readSrcCode(rel);
    for (const token of BREACH_TOKENS) {
      expect(code, `${rel} must not contain "${token}" in code (§21.5 breach)`).not.toContain(
        token,
      );
    }
  });

  it.each(SANCTIONED_TOUCHPOINTS)(
    'sanctioned touchpoint %s imports ONLY the count-only primitive',
    (rel) => {
      // Positive: the touchpoint exists and is wired to the audited primitive
      // (imports are real code, never commented — raw source is fine).
      const raw = readSrc(rel);
      expect(raw).toContain(
        "import { countRecentTrainingActivity } from '@/lib/training/training-trade-service'",
      );
      // Negative (code only): nothing else from the training module — no
      // model, no serializer, no other training service fn, no raw query.
      const code = readSrcCode(rel);
      for (const forbidden of [
        'TrainingTrade', // Prisma model / Serialized* / serialize* / *Model
        'db.trainingTrade',
        'listTrainingTradesForUser',
        'getTrainingTradeById',
        'createTrainingTrade',
      ]) {
        expect(code, `${rel} must not reference "${forbidden}" in code`).not.toContain(forbidden);
      }
      // Exactly one import line from the training module.
      const trainingImports = raw.match(/from\s+['"]@\/lib\/training[^'"]*['"]/g) ?? [];
      expect(trainingImports).toEqual(["from '@/lib/training/training-trade-service'"]);
    },
  );
});

// =============================================================================
// Block B — the count-only primitive is structurally count-only
// =============================================================================

describe('§21.5 — countRecentTrainingActivity is count/recency only', () => {
  it('its function body selects only a count + enteredAt (no P&L, no findMany)', () => {
    const full = readSrc('lib/training/training-trade-service.ts');
    const start = full.indexOf('export async function countRecentTrainingActivity');
    expect(start).toBeGreaterThan(-1);
    const body = full.slice(start); // it is the last export in the file

    expect(body).toContain('db.trainingTrade.count(');
    expect(body).toContain('select: { enteredAt: true }');
    // The function body must NOT widen to a P&L column or a full-row read.
    expect(body).not.toContain('findMany');
    expect(body).not.toContain('resultR');
    expect(body).not.toContain('plannedRR');
    expect(body).not.toContain('outcome');
  });
});

// =============================================================================
// Block C — engagement consumes ONLY an integer count (no P&L channel)
// =============================================================================

describe('§21.5 — engagement P&L-invariance + zero regression', () => {
  function fullishCheckins(): EngagementCheckinInput[] {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      const d = `2026-01-${String(i + 1).padStart(2, '0')}`;
      cs.push({ date: d, slot: 'morning', journalNote: null });
      cs.push({ date: d, slot: 'evening', journalNote: 'j' });
    }
    return cs;
  }

  it('a member with no training activity scores byte-identically to pre-J-T4', () => {
    const checkins = fullishCheckins();
    const omitted = computeEngagementScore({ checkins, streak: 14 });
    const zero = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 0 });
    expect(zero.score).toBe(omitted.score);
    expect(omitted.parts.trainingActivityRate).toBeNull();
    expect(zero.parts.trainingActivityRate).toBeNull();
  });

  it('engagement is a deterministic pure function of the integer count', () => {
    const checkins = fullishCheckins();
    const a = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 6 });
    const b = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 6 });
    expect(a.score).toBe(b.score);
    // Raising the count never lowers engagement (numerator ↑, max fixed).
    const more = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 8 });
    expect(more.score!).toBeGreaterThanOrEqual(a.score!);
  });
});

// =============================================================================
// Block D — trigger: schema round-trips, strict, PII-free snapshot
// =============================================================================

describe('§21.5 — no_training_activity_in_window trigger isolation', () => {
  it('the new kind round-trips through the discriminated-union schema', () => {
    expect(parseTriggerRule({ kind: 'no_training_activity_in_window', days: 14 })).toEqual({
      kind: 'no_training_activity_in_window',
      days: 14,
    });
  });

  it('strict schema rejects a P&L key smuggled into the rule', () => {
    expect(
      parseTriggerRule({ kind: 'no_training_activity_in_window', days: 14, resultR: 1.5 }),
    ).toBeNull();
  });

  it('a matched snapshot carries ONLY counts/dates — never a backtest P&L', () => {
    const ctx: TriggerContext = {
      now: new Date('2026-05-07T12:00:00Z'),
      timezone: 'Europe/Paris',
      todayLocal: '2026-05-07',
      recentClosedTrades: [],
      recentCheckins: [],
      recentAllTrades: [],
      userCreatedAt: new Date('2026-01-01T00:00:00Z'),
      lastTrainingActivityLocalDate: '2026-04-01',
    };
    const r = evalNoTrainingActivityInWindow(
      { kind: 'no_training_activity_in_window', days: 14 },
      ctx,
    );
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(Object.keys(r.snapshot.details).sort()).toEqual(
        ['accountAgeDays', 'daysSince', 'lastTrainingDate', 'requiredDays'].sort(),
      );
      expect(r.snapshot.details).not.toHaveProperty('resultR');
      expect(r.snapshot.details).not.toHaveProperty('outcome');
      expect(r.snapshot.details).not.toHaveProperty('plannedRR');
    }
  });
});

// =============================================================================
// Block E — weekly snapshot: strict schema forbids any P&L key in counters
// =============================================================================

describe('§21.5 — weekly snapshot counters are volume-only', () => {
  function minimalInput(trainingActivityCount?: number): BuilderInput {
    const base: BuilderInput = {
      userId: 'antileak_user',
      timezone: 'Europe/Paris',
      weekStart: new Date('2026-05-04T00:00:00Z'),
      weekEnd: new Date('2026-05-10T23:59:59.999Z'),
      trades: [],
      checkins: [],
      deliveries: [],
      annotationsReceived: 0,
      annotationsViewed: 0,
      latestScore: null,
    };
    return trainingActivityCount === undefined ? base : { ...base, trainingActivityCount };
  }

  it('the built snapshot is schema-valid and exposes trainingSessionsCount', () => {
    const snap = buildWeeklySnapshot(minimalInput(3));
    expect(snap.counters.trainingSessionsCount).toBe(3);
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('the .strict() counters schema rejects a smuggled backtest P&L key', () => {
    const snap = buildWeeklySnapshot(minimalInput(0));
    const tampered = {
      ...snap,
      counters: { ...snap.counters, resultR: 1.8 },
    };
    const parsed = weeklySnapshotSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('resultR');
    }
  });
});

// =============================================================================
// Block F — V1.3 TrainingDebrief (SPEC §23) stats stay process-only
// =============================================================================

/**
 * SPEC §23.5/§23.7 (BLOCKING): a `TrainingDebrief` and its computed process
 * stats reach NO real-edge surface, and the debrief service NEVER selects
 * `resultR` / `outcome` / `plannedRR`. Block A (BREACH_TOKENS extended with
 * `TrainingDebrief` / `db.trainingDebrief`) already proves no scoring /
 * analytics / trades / habit / weekly-report module references the debrief.
 * This block pins the debrief side: the pure aggregator and the service read
 * the four safe columns ONLY, and the debrief module imports no real edge.
 */
describe('§21.5 — TrainingDebrief stats are process-only (no backtest P&L)', () => {
  const PNL_TOKENS = ['resultR', 'outcome', 'plannedRR'] as const;

  it('the pure aggregator stats.ts has zero P&L token in code', () => {
    const code = readSrcCode('lib/training-debrief/stats.ts');
    for (const t of PNL_TOKENS) {
      expect(code, `stats.ts must not reference "${t}" in code (§21.5)`).not.toContain(t);
    }
  });

  it('the debrief service reads exactly the 4 safe columns + a bare annotation count', () => {
    const raw = readSrc('lib/training-debrief/service.ts');
    const code = readSrcCode('lib/training-debrief/service.ts');

    // Negative (code, comments stripped): no P&L column anywhere.
    for (const t of PNL_TOKENS) {
      expect(code, `service.ts must not reference "${t}" in code (§21.5)`).not.toContain(t);
    }

    // Positive: the trainingTrade read is an EXPLICIT safe projection and the
    // annotation rollup is a bare count (no findMany of comments / P&L).
    expect(raw).toContain('db.trainingTrade.findMany(');
    expect(raw).toContain('db.trainingAnnotation.count(');
    for (const safe of [
      'id: true',
      'enteredAt: true',
      'pair: true',
      'systemRespected: true',
      'lessonLearned: true',
    ]) {
      expect(raw, `service.ts safe select must keep "${safe}"`).toContain(safe);
    }
    // The trainingTrade query must be a select (projection), never a bare
    // findMany that would over-fetch the row (incl. resultR/outcome).
    const findManyIdx = code.indexOf('db.trainingTrade.findMany(');
    expect(findManyIdx).toBeGreaterThan(-1);
    expect(code.slice(findManyIdx, findManyIdx + 400)).toContain('select:');
  });

  it('the debrief module — INCLUDING the Server Action entry point — imports no real-edge module', () => {
    // The Server Action `app/training/debrief/actions.ts` is the entry point
    // and is NOT covered by the Block A real-edge glob (it scans lib/ trees,
    // never app/**). It is a carbon of `app/reflect/actions.ts`, which DOES
    // `revalidatePath('/dashboard')`. A future dev copy-pasting that line
    // would silently re-create the real-edge coupling §21.5 forbids — with a
    // green suite. Pin it here (security-auditor V1.3 finding).
    for (const rel of [
      'lib/training-debrief/stats.ts',
      'lib/training-debrief/service.ts',
      'lib/training-debrief/week.ts',
      'app/training/debrief/actions.ts',
    ]) {
      const raw = readSrc(rel);
      for (const forbidden of [
        '@/lib/scoring',
        '@/lib/analytics',
        '@/lib/trades',
        '@/lib/habit',
        '@/lib/weekly-report',
      ]) {
        expect(raw, `${rel} must not import ${forbidden} (§21.5)`).not.toContain(forbidden);
      }
    }
    // The debrief Server Action must NOT revalidate the real-edge dashboard
    // (it feeds nothing into engagement/scoring — SPEC §23.2 "aucun nouveau
    // couplage"). Comments stripped so the documenting comment doesn't trip.
    const actionCode = readSrcCode('app/training/debrief/actions.ts');
    expect(
      actionCode,
      "the debrief Server Action must not revalidatePath('/dashboard') (§21.5)",
    ).not.toContain("revalidatePath('/dashboard')");
  });
});

// =============================================================================
// Block G — V1.4 MonthlyDebrief (SPEC §25) stays §21.5-safe
// =============================================================================

/**
 * SPEC §25.7 (BLOCKING): the monthly AI debrief's TRAINING section is
 * count/recurrence ONLY (sourced from the J-T4 sanctioned primitive
 * `countRecentTrainingActivity`), the aggregator NEVER selects a backtest
 * `resultR`/`outcome`/`plannedRR`, and the real edge receives NOTHING from
 * the debrief. Block A (BREACH_TOKENS extended with `MonthlyDebrief` /
 * `db.monthlyDebrief` / `@/lib/monthly-debrief`) already proves no scoring /
 * analytics / trades / habit / weekly-report builder module references the
 * monthly debrief.
 *
 * 🚨 Block G is DELIBERATELY NOT a copy of Block F. The §25 firewall is
 * TRAINING-isolation only — UNLIKE the fully-isolated `TrainingDebrief`,
 * the monthly debrief's REAL section legitimately reads real-trade P&L
 * (`SerializedTrade.outcome`, the product) and ingests the ≤4 weekly AI
 * summaries of the month as INPUT (SPEC §25.3). So `outcome` /
 * `@/lib/weekly-report` are NOT forbidden here; the proof is STRUCTURAL:
 * the only training channel is the count-only primitive, and the snapshot
 * data-contract carries no backtest-P&L identifier.
 */
describe('§21.5 — MonthlyDebrief is §21.5-safe (training count-only, no backtest P&L)', () => {
  // `outcome` is intentionally EXCLUDED — the real section legitimately
  // reads `SerializedTrade.outcome` of a REAL trade (legitimate real-edge
  // P&L coaching, the §25 product). `resultR` / `plannedRR` are the
  // backtest-specific identifiers that must never appear.
  const BACKTEST_PNL_TOKENS = ['resultR', 'plannedRR'] as const;

  const MONTHLY_FOUNDATION = [
    'lib/schemas/monthly-debrief.ts',
    'lib/monthly-debrief/builder.ts',
    'lib/monthly-debrief/types.ts',
    'lib/monthly-debrief/month-window.ts',
  ] as const;

  it('the monthly schema + pure aggregator carry no backtest-P&L identifier', () => {
    // The training slice is structurally count/recency only; the real
    // counters use win/loss/BE tallies, never a raw backtest P&L field.
    for (const rel of MONTHLY_FOUNDATION) {
      const code = readSrcCode(rel);
      for (const t of BACKTEST_PNL_TOKENS) {
        expect(code, `${rel} must not reference "${t}" in code (§21.5/§25.7)`).not.toContain(t);
      }
    }
  });

  it('the monthly module reaches training EXCLUSIVELY via the count-only primitive', () => {
    // Structural §25.7 proof: the ONLY sanctioned training channel is
    // `countRecentTrainingActivity` ({ count, enteredAt } — pinned by
    // Block B). No `db.trainingTrade` projection, no `@/lib/training-debrief`,
    // no `TrainingTrade` model reference anywhere in the monthly foundation.
    // (J-M2 adds `lib/monthly-debrief/loader.ts` as a 4th sanctioned
    // touchpoint importing ONLY the primitive — pinned by Block A then.)
    for (const rel of MONTHLY_FOUNDATION) {
      const code = readSrcCode(rel);
      for (const forbidden of [
        'TrainingTrade',
        'db.trainingTrade',
        '@/lib/training',
        '@/lib/training-debrief',
        'TrainingDebrief',
        'db.trainingDebrief',
      ]) {
        expect(
          code,
          `${rel} must not reference "${forbidden}" in code (§25.7 — training only via the primitive)`,
        ).not.toContain(forbidden);
      }
    }
  });

  it('the monthly foundation feeds NOTHING into the real edge (no new coupling, canon §23)', () => {
    // SPEC §25.7 "l'edge réel ne reçoit JAMAIS rien du débrief". The pure
    // foundation must not import a real-edge writer nor revalidate the
    // real-edge dashboard. (J-M2's loader will READ a persisted score for
    // the real section — sanctioned by §25.3, exactly like
    // `weekly-report/loader.ts` — so the loader is asserted separately as a
    // sanctioned touchpoint, not blanket-forbidden, when it lands.)
    for (const rel of ['lib/monthly-debrief/builder.ts', 'lib/monthly-debrief/month-window.ts']) {
      const code = readSrcCode(rel);
      for (const forbidden of [
        '@/lib/scoring',
        '@/lib/analytics',
        '@/lib/habit',
        'revalidatePath',
      ]) {
        expect(
          code,
          `${rel} must not couple to ${forbidden} (§25.7 no new edge coupling)`,
        ).not.toContain(forbidden);
      }
    }
  });
});
