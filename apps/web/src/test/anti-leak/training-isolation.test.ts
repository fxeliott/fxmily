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

/** The 3 deliberate touchpoints — may import ONLY the count-only primitive. */
const SANCTIONED_TOUCHPOINTS = [
  'lib/scoring/service.ts',
  'lib/triggers/engine.ts',
  'lib/weekly-report/loader.ts',
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
// the Prisma model (`TrainingTrade`), its serializers
// (`SerializedTrainingTrade`, `serializeTrainingTrade`, `TrainingTradeModel`),
// a `db.trainingTrade` query, or an import of the training module.
const BREACH_TOKENS = ['TrainingTrade', 'db.trainingTrade', '@/lib/training'];

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
