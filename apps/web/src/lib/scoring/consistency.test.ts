import { describe, expect, it } from 'vitest';

import { computeConsistencyScore, type ConsistencyTradeInput } from './consistency';

const T = (
  outcome: 'win' | 'loss' | 'break_even',
  r: number,
  ts = '2026-01-01T10:00:00Z',
  session: 'asia' | 'london' | 'newyork' | 'overlap' = 'london',
  source: 'computed' | 'estimated' = 'computed',
): ConsistencyTradeInput => ({
  outcome,
  realizedR: String(r),
  realizedRSource: source,
  closedAt: ts,
  exitedAt: ts,
  session,
});

const isoDay = (i: number) => `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`;

describe('computeConsistencyScore', () => {
  it('returns no_trades when no closed trades exist', () => {
    const r = computeConsistencyScore({ trades: [] });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_trades');
    expect(r.sample.trades).toBe(0);
  });

  it('returns no_computed_trades when only estimated trades exist', () => {
    const trades = [
      T('win', 1, isoDay(0), 'london', 'estimated'),
      T('loss', -1, isoDay(1), 'london', 'estimated'),
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_computed_trades');
  });

  it('flags insufficient sample below 20 closed trades', () => {
    const trades = Array.from({ length: 15 }, (_, i) => T('win', 1, isoDay(i)));
    const r = computeConsistencyScore({ trades });
    expect(r.status).toBe('ok');
    expect(r.sample.sufficient).toBe(false);
  });

  it('returns ok with sufficient sample at 20 trades', () => {
    const trades = Array.from({ length: 20 }, (_, i) => T('win', 1, isoDay(i)));
    const r = computeConsistencyScore({ trades });
    expect(r.sample.sufficient).toBe(true);
  });

  it('rewards high expectancy with high expectancyConsistency', () => {
    // 20 trades all winning at 3R → expectancy = 3R, max sub-score
    const trades = Array.from({ length: 20 }, (_, i) => T('win', 3, isoDay(i)));
    const r = computeConsistencyScore({ trades });
    expect(r.parts.expectancyConsistency.rate).toBe(1);
    expect(r.parts.expectancyConsistency.pointsAwarded).toBe(35);
  });

  it('penalizes negative expectancy with 0 expectancyConsistency', () => {
    // 50% WR but avgWin=0.5R, avgLoss=-1R → expectancy = -0.25R
    const trades: ConsistencyTradeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => T('win', 0.5, isoDay(i))),
      ...Array.from({ length: 10 }, (_, i) => T('loss', -1, isoDay(10 + i))),
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.parts.expectancyConsistency.rate).toBe(0);
  });

  it('rewards high profit factor with high profitFactor sub-score', () => {
    // 70% WR, avgWin=2R, avgLoss=-1R → PF = 14/3 ≈ 4.67 (clamped at 3 → 100)
    const trades: ConsistencyTradeInput[] = [
      ...Array.from({ length: 14 }, (_, i) => T('win', 2, isoDay(i))),
      ...Array.from({ length: 6 }, (_, i) => T('loss', -1, isoDay(14 + i))),
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.parts.profitFactor.rate).toBe(1);
  });

  it('penalizes large drawdown', () => {
    // Build a curve with a single deep drawdown of 16R (full scale)
    const trades: ConsistencyTradeInput[] = [
      ...Array.from({ length: 4 }, (_, i) => T('win', 4, isoDay(i))), // peak +16
      ...Array.from({ length: 16 }, (_, i) => T('loss', -1, isoDay(i + 4))), // 16R DD
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.parts.drawdownControl.rate).toBe(0); // 16R DD ≥ 15R full scale
  });

  it('rewards focused sessions over scattered ones', () => {
    const focused = Array.from({ length: 20 }, (_, i) => T('win', 1, isoDay(i), 'london'));
    const scattered: ConsistencyTradeInput[] = Array.from({ length: 20 }, (_, i) =>
      T('win', 1, isoDay(i), (['asia', 'london', 'newyork', 'overlap'] as const)[i % 4]!),
    );
    const rFocused = computeConsistencyScore({ trades: focused });
    const rScattered = computeConsistencyScore({ trades: scattered });
    expect(rFocused.parts.sessionDispersion.rate).toBe(1);
    expect(rScattered.parts.sessionDispersion.rate).toBe(0);
  });

  it('skips lossStreakControl when expected streak is 0 (no losses)', () => {
    const trades = Array.from({ length: 20 }, (_, i) => T('win', 1, isoDay(i)));
    const r = computeConsistencyScore({ trades });
    expect(r.parts.lossStreakControl).toBeNull();
  });

  it('rewards an observed streak well below the theoretical expected', () => {
    // 80% WR, n=20 (16W 4L), observed_max_streak = 1 (no consecutive losses)
    // expectedMaxLoss(20, 0.2) = ceil(log(20)/log(5)) = 2
    // streakRatio = 1/2 = 0.5 → streakValue = 1 - 0.5/2 = 0.75
    const trades: ConsistencyTradeInput[] = [
      // alternate W*4 W*4 ... with one loss every ~5 trades
      T('win', 1, isoDay(0)),
      T('win', 1, isoDay(1)),
      T('win', 1, isoDay(2)),
      T('win', 1, isoDay(3)),
      T('loss', -1, isoDay(4)),
      T('win', 1, isoDay(5)),
      T('win', 1, isoDay(6)),
      T('win', 1, isoDay(7)),
      T('win', 1, isoDay(8)),
      T('loss', -1, isoDay(9)),
      T('win', 1, isoDay(10)),
      T('win', 1, isoDay(11)),
      T('win', 1, isoDay(12)),
      T('win', 1, isoDay(13)),
      T('loss', -1, isoDay(14)),
      T('win', 1, isoDay(15)),
      T('win', 1, isoDay(16)),
      T('win', 1, isoDay(17)),
      T('win', 1, isoDay(18)),
      T('loss', -1, isoDay(19)),
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.parts.lossStreakControl).not.toBeNull();
    expect(r.parts.lossStreakControl!.numerator).toBe(1);
    expect(r.parts.lossStreakControl!.denominator).toBe(2);
    expect(r.parts.lossStreakControl!.rate).toBeGreaterThan(0.5);
  });

  it('penalizes when observed streak meets or exceeds expected (variance gone wrong)', () => {
    // 50% WR, n=20, observed = expected → ratio = 1 → streakValue = 0.5
    const trades: ConsistencyTradeInput[] = [
      // 5L cluster for the observed worst streak, then mixed
      ...Array.from({ length: 5 }, (_, i) => T('loss', -1, isoDay(i))),
      T('win', 1, isoDay(5)),
      T('win', 1, isoDay(6)),
      T('loss', -1, isoDay(7)),
      T('win', 1, isoDay(8)),
      T('loss', -1, isoDay(9)),
      T('win', 1, isoDay(10)),
      T('loss', -1, isoDay(11)),
      T('win', 1, isoDay(12)),
      T('loss', -1, isoDay(13)),
      T('win', 1, isoDay(14)),
      T('loss', -1, isoDay(15)),
      T('win', 1, isoDay(16)),
      T('win', 1, isoDay(17)),
      T('win', 1, isoDay(18)),
      T('win', 1, isoDay(19)),
    ];
    const r = computeConsistencyScore({ trades });
    expect(r.parts.lossStreakControl).not.toBeNull();
    // observed=5, expected at 0.5 lossRate, n=20 = ceil(log(20)/log(2)) = 5
    expect(r.parts.lossStreakControl!.rate).toBeLessThanOrEqual(0.5);
  });

  it('returns a numeric overall score in [0, 100]', () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      T(i % 2 === 0 ? 'win' : 'loss', i % 2 === 0 ? 2 : -1, isoDay(i), 'london'),
    );
    const r = computeConsistencyScore({ trades });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
