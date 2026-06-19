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
  // S3/S4 — the verification module reads `db.trade` (the real journal) and
  // writes the member's ScoreEvents: a real-edge tree like any other. Added
  // S4 (INT-F1) — the glob promise « any future file is covered by default »
  // only holds if every new real-edge TREE joins the list at its birth.
  ...tsFilesIn('lib/verification'),
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
  // S8 — backtest SESSION container ("crée une session de backtest", brief
  // §31 DoD#1). It lives 100% inside the §21.5 training world (no FK to any
  // real-edge model). The existing `TrainingTrade` token does NOT match
  // `TrainingSession` (distinct identifier), and `@/lib/training` only catches
  // an import path — so the model name + the db accessor are listed explicitly
  // to forbid a real-edge module from ever referencing the session container.
  // (`db.trainingSession` is the Prisma accessor; `TrainingSession` catches the
  // model, its `Serialized*`/`*Model` types and a serializer reference.)
  'TrainingSession',
  'db.trainingSession',
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
  // V1.5 — SPEC §27 QCM athlète (auto-évaluation mindset). The mindset check
  // is psychology-pure, ORTHOGONAL to the real edge AND the training surface
  // (§27.7 BLOCKING: "ne nourrit NI BehavioralScore §7.11 NI engagement NI
  // trigger"). It is the most isolated entity of the §21.6 sequence — a
  // 0-FK table read only by its own module, profile computed purely. The
  // model / `db.mindsetCheck` accessor / `@/lib/mindset` lib path must never
  // appear in a real-edge module (`MindsetCheckInput` etc. are superstrings
  // of `MindsetCheck`, so a schema-type import is caught too — mirror §23).
  'MindsetCheck',
  'db.mindsetCheck',
  '@/lib/mindset',
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
      // DOD3-01 / DoD#2 S6 — Session-3 counters (count-only, empty/no-signal here).
      verification: { constancy: null, openDiscrepancyCount: 0, alertCount: 0 },
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

// =============================================================================
// Block H — V1.5 MindsetCheck (SPEC §27) is the MOST isolated entity
// =============================================================================

/**
 * SPEC §27.7 (BLOCKING): the mindset check is psychology-pure, ORTHOGONAL to
 * BOTH the real edge and the training surface. It is even more isolated than
 * `TrainingDebrief` (Block F): there is NO §21.5-sensitive cross-read at all
 * (no `trainingTrade` projection — the profile is computed PURELY from the
 * row's own `responses`). Block A (BREACH_TOKENS extended with `MindsetCheck`
 * / `db.mindsetCheck` / `@/lib/mindset`) already proves no globbed real-edge
 * module references it. Block H pins BOTH sides:
 *   - the mindset module (incl. its Server Action) imports no real edge,
 *     reads ONLY `db.mindsetCheck`, names no P&L, never revalidates
 *     `/dashboard`;
 *   - §27.7 explicit — the SANCTIONED touchpoints + the score/trigger
 *     engines (which Block A's real-edge glob does NOT scan) reference NO
 *     mindset token: the QCM feeds NOTHING into `BehavioralScore` §7.11 /
 *     engagement / triggers.
 */
describe('§21.5/§27.7 — MindsetCheck is fully isolated (psychology-pure, 0 coupling)', () => {
  const PNL_TOKENS = ['resultR', 'outcome', 'plannedRR'] as const;
  const REAL_EDGE_IMPORTS = [
    '@/lib/scoring',
    '@/lib/analytics',
    '@/lib/trades',
    '@/lib/habit',
    '@/lib/weekly-report',
    '@/lib/triggers',
  ] as const;
  const MINDSET_PURE = [
    'lib/mindset/instrument.ts',
    'lib/mindset/profile.ts',
    'lib/mindset/week.ts',
  ] as const;
  const MINDSET_MODULE = [
    ...MINDSET_PURE,
    'lib/mindset/service.ts',
    'lib/mindset/reminders.ts',
    'lib/schemas/mindset-check.ts',
    'app/mindset/actions.ts',
    'app/api/cron/mindset-check-reminders/route.ts',
  ] as const;
  const MINDSET_TOKENS = ['MindsetCheck', 'db.mindsetCheck', '@/lib/mindset'] as const;

  it('the pure mindset modules carry no P&L token and no real-edge object', () => {
    for (const rel of MINDSET_PURE) {
      const code = readSrcCode(rel);
      for (const t of [
        ...PNL_TOKENS,
        'TrainingTrade',
        'db.trainingTrade',
        'db.trade',
        'db.behavioralScore',
      ]) {
        expect(code, `${rel} must not reference "${t}" in code (§27.7)`).not.toContain(t);
      }
    }
  });

  it('the mindset service reads ONLY db.mindsetCheck — no real-edge object, no P&L', () => {
    const raw = readSrc('lib/mindset/service.ts');
    const code = readSrcCode('lib/mindset/service.ts');
    expect(raw).toContain('db.mindsetCheck.');
    for (const forbidden of [
      'db.trade',
      'db.trainingTrade',
      'db.behavioralScore',
      'db.weeklyReport',
      'db.monthlyDebrief',
      ...PNL_TOKENS,
    ]) {
      expect(code, `service.ts must not reference "${forbidden}" (§27.7)`).not.toContain(forbidden);
    }
  });

  it('the mindset module — INCLUDING the Server Action — imports no real-edge module nor revalidates /dashboard', () => {
    for (const rel of MINDSET_MODULE) {
      const raw = readSrc(rel);
      for (const imp of REAL_EDGE_IMPORTS) {
        expect(raw, `${rel} must not import ${imp} (§27.7)`).not.toContain(imp);
      }
    }
    const actionCode = readSrcCode('app/mindset/actions.ts');
    expect(
      actionCode,
      "the mindset Server Action must not revalidatePath('/dashboard') (§27.7)",
    ).not.toContain("revalidatePath('/dashboard')");
  });

  it('§27.7 — the QCM feeds NOTHING into scoring / engagement / triggers', () => {
    // These modules are NOT all under Block A's real-edge glob (the
    // sanctioned touchpoints + the trigger dir are excluded), so the
    // "mindset never reaches the score/trigger engine" proof lives here.
    for (const rel of [
      'lib/scoring/service.ts',
      'lib/scoring/engagement.ts',
      'lib/triggers/engine.ts',
      'lib/triggers/evaluators.ts',
      'lib/weekly-report/loader.ts',
      'lib/monthly-debrief/loader.ts',
    ]) {
      const code = readSrcCode(rel);
      for (const token of MINDSET_TOKENS) {
        expect(
          code,
          `${rel} must not reference "${token}" — the QCM feeds nothing into the edge (§27.7)`,
        ).not.toContain(token);
      }
    }
  });
});

// =============================================================================
// Block I — S8 TrainingSession container stays §21.5-isolated
// =============================================================================

/**
 * S8 — the backtest-SESSION container (`TrainingSession`) is a pure
 * organisational grouping that lives 100% inside the training world. Block A
 * (BREACH_TOKENS extended with `TrainingSession` / `db.trainingSession`)
 * already proves no real-edge module references it. Block I pins the session
 * module side: its services + Server Action import no real edge, never
 * revalidate `/dashboard`, and the real-edge ACTIVITY channel still counts
 * BACKTESTS (`db.trainingTrade`), never sessions — a container changes nothing
 * on the engagement / trigger / report signal.
 */
describe('§21.5 — TrainingSession container is training-isolated', () => {
  const SESSION_MODULE = [
    'lib/training/training-session-service.ts',
    'lib/training/training-session-admin-service.ts',
    'app/training/sessions/actions.ts',
    // S8 verif-layer — `app/training/actions.ts` is the PRIMARY backtest-write
    // Server Action (`createTrainingTradeAction`) and was the only one of the 3
    // training Server Actions whose anti-`/dashboard` revalidate + no-real-edge
    // import contract was not pinned (debrief is in Block F, sessions above).
    'app/training/actions.ts',
  ] as const;
  const REAL_EDGE_IMPORTS = [
    '@/lib/scoring',
    '@/lib/analytics',
    '@/lib/trades',
    '@/lib/habit',
    '@/lib/weekly-report',
    '@/lib/verification',
  ] as const;

  it('the session module imports no real-edge module', () => {
    for (const rel of SESSION_MODULE) {
      const code = readSrcCode(rel);
      for (const imp of REAL_EDGE_IMPORTS) {
        expect(code, `${rel} must not import ${imp} (§21.5)`).not.toContain(imp);
      }
    }
  });

  it('the training Server Actions never revalidate the real-edge dashboard', () => {
    // Both the session container action AND the primary backtest-write action:
    // a backtest write must revalidate the training surface ONLY, never the
    // real-edge dashboard/journal (§21.5).
    for (const rel of ['app/training/sessions/actions.ts', 'app/training/actions.ts']) {
      const actionCode = readSrcCode(rel);
      expect(actionCode, `${rel} must not revalidatePath('/dashboard') (§21.5)`).not.toContain(
        "revalidatePath('/dashboard')",
      );
      expect(actionCode, `${rel} must not revalidatePath('/journal') (§21.5)`).not.toContain(
        "revalidatePath('/journal')",
      );
    }
  });

  it('the real-edge activity channel still counts BACKTESTS, never sessions', () => {
    // Wiring a session container must NOT redirect the engagement signal onto
    // sessions: the sanctioned primitive keeps counting `db.trainingTrade`.
    const full = readSrc('lib/training/training-trade-service.ts');
    const start = full.indexOf('export async function countRecentTrainingActivity');
    expect(start).toBeGreaterThan(-1);
    const body = full.slice(start);
    expect(body).toContain('db.trainingTrade.count(');
    expect(body).not.toContain('db.trainingSession');
  });
});
