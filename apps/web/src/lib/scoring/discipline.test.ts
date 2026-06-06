import { describe, expect, it } from 'vitest';

import {
  computeDisciplineScore,
  type DisciplineCheckinInput,
  type DisciplineTradeInput,
} from './discipline';

const T = (
  planRespected: boolean,
  hedgeRespected: boolean | null = null,
  processComplete: boolean | null = null,
): DisciplineTradeInput => ({
  closedAt: '2026-01-01T10:00:00Z',
  planRespected,
  hedgeRespected,
  processComplete,
});

const M = (
  intention: string | null,
  routine: boolean | null = null,
  marketAnalysisDone: boolean | null = null,
): DisciplineCheckinInput => ({
  slot: 'morning',
  planRespectedToday: null,
  morningRoutineCompleted: routine,
  intention,
  marketAnalysisDone,
});

const E = (planRespected: boolean | null): DisciplineCheckinInput => ({
  slot: 'evening',
  planRespectedToday: planRespected,
  morningRoutineCompleted: null,
  intention: null,
  marketAnalysisDone: null,
});

describe('computeDisciplineScore', () => {
  it('returns insufficient_data with reason=no_trades when both sides empty', () => {
    const r = computeDisciplineScore({ trades: [], checkins: [] });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('no_trades');
    expect(r.sample.sufficient).toBe(false);
  });

  it('returns 100 when every applicable sub-score is perfect', () => {
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(true, true));
    const checkins: DisciplineCheckinInput[] = [
      ...Array.from({ length: 14 }, () => M('intention', true)),
      ...Array.from({ length: 14 }, () => E(true)),
    ];
    const r = computeDisciplineScore({ trades, checkins });
    expect(r.score).toBe(100);
    expect(r.status).toBe('ok');
    expect(r.sample.sufficient).toBe(true);
  });

  it('returns 0 when every applicable sub-score is failed', () => {
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(false, false));
    const checkins: DisciplineCheckinInput[] = [
      ...Array.from({ length: 14 }, () => M(null, false)),
      ...Array.from({ length: 14 }, () => E(false)),
    ];
    const r = computeDisciplineScore({ trades, checkins });
    expect(r.score).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('renormalizes when all hedge are N/A (skips the sub-score)', () => {
    // 100% plan respect, no hedge applicable, no checkins → only plan counts → 100
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(true, null));
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(100);
  });

  it('respects partial sub-scores (50% plan, 100% hedge)', () => {
    // 6 plan win + 6 fail, all hedge true → plan rate=0.5 (×35=17.5), hedge rate=1 (×20=20)
    // Active weights = 55, awarded = 37.5 → score = 37.5 / 55 * 100 ≈ 68.18 → 68
    const trades: DisciplineTradeInput[] = [
      ...Array.from({ length: 6 }, () => T(true, true)),
      ...Array.from({ length: 6 }, () => T(false, true)),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(68);
  });

  it('flags insufficient sample when below trade-only threshold', () => {
    const trades = Array.from({ length: 5 }, () => T(true, true));
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.status).toBe('ok');
    expect(r.sample.sufficient).toBe(false);
    expect(r.sample.trades).toBe(5);
  });

  it('uses intention.trim() — pure whitespace counts as null', () => {
    const trades = Array.from({ length: 5 }, () => T(true, true));
    const checkins: DisciplineCheckinInput[] = [
      ...Array.from({ length: 14 }, () => M('   ', true)), // whitespace only
    ];
    const r = computeDisciplineScore({ trades, checkins });
    // intention rate=0, routine=1, plan=1, hedge=1 → 35+20+10+0 / 75 = 65/75*100 ≈ 86.67 → 87
    // (no evening, so eveningPlan skipped)
    expect(r.score).toBe(87);
  });

  it('handles morning-only checkins (no evenings → skip evening sub-score)', () => {
    const trades = Array.from({ length: 12 }, () => T(true, true));
    const checkins = Array.from({ length: 14 }, () => M('plan', true));
    const r = computeDisciplineScore({ trades, checkins });
    // All sub-scores perfect except eveningPlan is skipped
    expect(r.score).toBe(100);
    expect(r.sample.sufficient).toBe(true);
  });

  it('returns ok status when only check-ins exist (no trades)', () => {
    const checkins = [
      ...Array.from({ length: 14 }, () => M('plan', true)),
      ...Array.from({ length: 14 }, () => E(true)),
    ];
    const r = computeDisciplineScore({ trades: [], checkins });
    expect(r.status).toBe('ok');
    expect(r.score).toBe(100);
  });

  it('open trades are filtered out of the closed-trade math', () => {
    // 1 closed perfect + 99 open(null closedAt) → only 1 trade counts
    const trades: DisciplineTradeInput[] = [
      T(true, true),
      ...Array.from({ length: 99 }, () => ({
        closedAt: null,
        planRespected: false,
        hedgeRespected: false,
        processComplete: false,
      })),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(100); // single closed trade was perfect
    expect(r.sample.trades).toBe(1);
    expect(r.sample.sufficient).toBe(false); // <10 closed
  });

  it('exposes per-sub-score numerator/denominator in parts', () => {
    const trades = [T(true, true), T(false, true), T(true, false)]; // 3 closed
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.parts.planRespect.numerator).toBe(2);
    expect(r.parts.planRespect.denominator).toBe(3);
    expect(r.parts.hedgeRespect.numerator).toBe(2);
    expect(r.parts.hedgeRespect.denominator).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DoD#3 — market-analysis (morning prep) sub-score.
//
// ADDITION PURE: `WEIGHT_MARKET_ANALYSIS` (10) is added EN PLUS; the existing
// five weights (35/20/25/10/10) are NEVER rebalanced. A member whose mornings
// never carry `marketAnalysisDone` (every pre-DoD#3 / legacy row) scores
// BYTE-IDENTICALLY to pre-DoD#3 — the part is `null` and renormalized away.
//
// The skip is keyed on field-PRESENCE (`marketAnalysisDone !== null`), exactly
// like discipline's hedge N/A skip: a morning where the member was NOT asked
// never penalizes the rate; a morning where they answered `false` (skipped the
// prep) counts in the denominator and lowers the rate (the effort signal).
// ---------------------------------------------------------------------------

describe('computeDisciplineScore — market analysis (DoD#3)', () => {
  it('ZERO REGRESSION — absent field (all-null) ≡ pre-DoD#3 (byte-identical, part null)', () => {
    // 50% plan, 100% hedge, no morning field carries marketAnalysisDone (null).
    // This is the EXACT input of the existing "respects partial sub-scores"
    // test (score 68) — proves the addition is byte-identical when absent.
    const trades: DisciplineTradeInput[] = [
      ...Array.from({ length: 6 }, () => T(true, true)),
      ...Array.from({ length: 6 }, () => T(false, true)),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(68); // pinned pre-DoD#3 value
    expect(r.parts.marketAnalysisDone).toBeNull();
  });

  it('all mornings null → market part skipped even with morning data present', () => {
    // 14 mornings with intention+routine perfect but marketAnalysisDone null.
    // Pre-DoD#3: intention(10) + routine(10) both rate 1 → 100. Must stay 100.
    const checkins = Array.from({ length: 14 }, () => M('plan', true, null));
    const r = computeDisciplineScore({ trades: [], checkins });
    expect(r.score).toBe(100);
    expect(r.parts.marketAnalysisDone).toBeNull();
  });

  it('present + all done → full WEIGHT_MARKET_ANALYSIS contribution (still 100 when perfect)', () => {
    // 14 mornings: intention + routine + marketAnalysisDone all perfect.
    // Active morning weights: intention 10 + routine 10 + market 10, all rate 1
    // → 100. Adding a perfect sub-score keeps a perfect dimension at 100.
    const checkins = Array.from({ length: 14 }, () => M('plan', true, true));
    const r = computeDisciplineScore({ trades: [], checkins });
    expect(r.score).toBe(100);
    expect(r.parts.marketAnalysisDone).not.toBeNull();
    expect(r.parts.marketAnalysisDone?.rate).toBe(1);
    expect(r.parts.marketAnalysisDone?.pointsMax).toBe(10);
    expect(r.parts.marketAnalysisDone?.pointsAwarded).toBe(10);
  });

  it('present + all skipped (false) → rate 0, sub-score present (effort signal)', () => {
    // 14 mornings: intention + routine perfect, marketAnalysisDone all FALSE.
    // intention 10 + routine 10 awarded = 20; market 0/10 awarded.
    // active max = 30 → 20/30 × 100 = 66.6̄ → 67.
    const checkins = Array.from({ length: 14 }, () => M('plan', true, false));
    const r = computeDisciplineScore({ trades: [], checkins });
    expect(r.score).toBe(67);
    expect(r.parts.marketAnalysisDone).not.toBeNull();
    expect(r.parts.marketAnalysisDone?.rate).toBe(0);
    expect(r.parts.marketAnalysisDone?.numerator).toBe(0);
    expect(r.parts.marketAnalysisDone?.denominator).toBe(14);
  });

  it('only-asked mornings count in the denominator (null mornings excluded)', () => {
    // 7 mornings done(true) + 7 mornings not-asked(null). intention+routine
    // present (true) on all 14, marketAnalysisDone only on the first 7.
    const checkins = [
      ...Array.from({ length: 7 }, () => M('plan', true, true)),
      ...Array.from({ length: 7 }, () => M('plan', true, null)),
    ];
    const r = computeDisciplineScore({ trades: [], checkins });
    expect(r.parts.marketAnalysisDone?.numerator).toBe(7);
    expect(r.parts.marketAnalysisDone?.denominator).toBe(7); // null mornings excluded
    expect(r.parts.marketAnalysisDone?.rate).toBe(1);
  });

  it('partial (3 done / 6 asked) sits strictly between skipped and full', () => {
    const skipped = computeDisciplineScore({
      trades: [],
      checkins: Array.from({ length: 6 }, () => M('plan', true, false)),
    });
    const partial = computeDisciplineScore({
      trades: [],
      checkins: [
        ...Array.from({ length: 3 }, () => M('plan', true, true)),
        ...Array.from({ length: 3 }, () => M('plan', true, false)),
      ],
    });
    const full = computeDisciplineScore({
      trades: [],
      checkins: Array.from({ length: 6 }, () => M('plan', true, true)),
    });
    expect(partial.parts.marketAnalysisDone?.rate).toBe(0.5);
    expect(partial.score!).toBeGreaterThan(skipped.score!);
    expect(partial.score!).toBeLessThan(full.score!);
  });
});

// ---------------------------------------------------------------------------
// SPEC §28/§21 — "oublis" (processComplete) sub-score.
//
// ADDITION PURE: `WEIGHT_PROCESS_COMPLETE` (10) is added EN PLUS; the existing
// weights are NEVER rebalanced. A member whose closed trades never carry
// `processComplete` (every pre-§28 / legacy trade) scores BYTE-IDENTICALLY to
// pre-§28 — the part is `null` and renormalized away.
//
// The skip is keyed on field-PRESENCE (`processComplete !== null`), exactly
// like discipline's hedge N/A skip and marketAnalysis: a trade where the member
// was NOT asked never penalizes the rate; a trade where they answered `false`
// (forgot/missed steps) counts in the denominator and lowers the rate (the
// effort signal). SPEC §2: the ACT of completeness only, never advice.
// ---------------------------------------------------------------------------

describe('computeDisciplineScore — process complete / "oublis" (SPEC §28/§21)', () => {
  it('ZERO REGRESSION — absent field (all-null) ≡ pre-§28 (byte-identical, part null)', () => {
    // EXACT input of the existing "respects partial sub-scores" test (score 68):
    // T(_, true) leaves processComplete null. Proves the addition is
    // byte-identical when absent.
    const trades: DisciplineTradeInput[] = [
      ...Array.from({ length: 6 }, () => T(true, true)),
      ...Array.from({ length: 6 }, () => T(false, true)),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(68); // pinned pre-§28 value
    expect(r.parts.processComplete).toBeNull();
  });

  it('all closed trades null → process part skipped even with trade data present', () => {
    // 12 trades, plan+hedge perfect, processComplete null on every one.
    // Pre-§28: plan(35) + hedge(20) both rate 1 → 100. Must stay 100.
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(true, true, null));
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(100);
    expect(r.parts.processComplete).toBeNull();
  });

  it('present + all complete → full WEIGHT_PROCESS_COMPLETE contribution (still 100 when perfect)', () => {
    // 12 trades: plan + hedge + processComplete all perfect → still 100.
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(true, true, true));
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(100);
    expect(r.parts.processComplete).not.toBeNull();
    expect(r.parts.processComplete?.rate).toBe(1);
    expect(r.parts.processComplete?.pointsMax).toBe(10);
    expect(r.parts.processComplete?.pointsAwarded).toBe(10);
  });

  it('present + all forgot (false) → rate 0, sub-score present (effort signal)', () => {
    // 12 trades: plan + hedge perfect, processComplete all FALSE.
    // plan 35 + hedge 20 awarded = 55; process 0/10 awarded.
    // active max = 65 → 55/65 × 100 = 84.6̄ → 85.
    const trades: DisciplineTradeInput[] = Array.from({ length: 12 }, () => T(true, true, false));
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.score).toBe(85);
    expect(r.parts.processComplete).not.toBeNull();
    expect(r.parts.processComplete?.rate).toBe(0);
    expect(r.parts.processComplete?.numerator).toBe(0);
    expect(r.parts.processComplete?.denominator).toBe(12);
  });

  it('only-answered trades count in the denominator (null trades excluded)', () => {
    // 6 complete(true) + 6 not-asked(null). plan+hedge present on all 12.
    const trades: DisciplineTradeInput[] = [
      ...Array.from({ length: 6 }, () => T(true, true, true)),
      ...Array.from({ length: 6 }, () => T(true, true, null)),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.parts.processComplete?.numerator).toBe(6);
    expect(r.parts.processComplete?.denominator).toBe(6); // null trades excluded
    expect(r.parts.processComplete?.rate).toBe(1);
  });

  it('partial (3 complete / 6 answered) sits strictly between forgot and full', () => {
    const forgot = computeDisciplineScore({
      trades: Array.from({ length: 6 }, () => T(true, true, false)),
      checkins: [],
    });
    const partial = computeDisciplineScore({
      trades: [
        ...Array.from({ length: 3 }, () => T(true, true, true)),
        ...Array.from({ length: 3 }, () => T(true, true, false)),
      ],
      checkins: [],
    });
    const full = computeDisciplineScore({
      trades: Array.from({ length: 6 }, () => T(true, true, true)),
      checkins: [],
    });
    expect(partial.parts.processComplete?.rate).toBe(0.5);
    expect(partial.score!).toBeGreaterThan(forgot.score!);
    expect(partial.score!).toBeLessThan(full.score!);
  });

  it('open trades are excluded from the "oublis" denominator (closed-only)', () => {
    // 1 closed answered(true) + 5 open with processComplete=false → only the
    // closed one counts (open trades filtered out before the rate).
    const trades: DisciplineTradeInput[] = [
      T(true, true, true),
      ...Array.from({ length: 5 }, () => ({
        closedAt: null,
        planRespected: true,
        hedgeRespected: true,
        processComplete: false,
      })),
    ];
    const r = computeDisciplineScore({ trades, checkins: [] });
    expect(r.parts.processComplete?.numerator).toBe(1);
    expect(r.parts.processComplete?.denominator).toBe(1);
  });
});
