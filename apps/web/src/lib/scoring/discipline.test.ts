import { describe, expect, it } from 'vitest';

import {
  computeDisciplineScore,
  type DisciplineCheckinInput,
  type DisciplineTradeInput,
} from './discipline';

const T = (
  planRespected: boolean,
  hedgeRespected: boolean | null = null,
): DisciplineTradeInput => ({
  closedAt: '2026-01-01T10:00:00Z',
  planRespected,
  hedgeRespected,
});

const M = (intention: string | null, routine: boolean | null = null): DisciplineCheckinInput => ({
  slot: 'morning',
  planRespectedToday: null,
  morningRoutineCompleted: routine,
  intention,
});

const E = (planRespected: boolean | null): DisciplineCheckinInput => ({
  slot: 'evening',
  planRespectedToday: planRespected,
  morningRoutineCompleted: null,
  intention: null,
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
