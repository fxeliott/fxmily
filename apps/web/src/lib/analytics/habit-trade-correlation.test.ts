import { describe, expect, it } from 'vitest';

import {
  buildHabitHeatmap,
  computeHabitTradeCorrelation,
  extractHabitScalar,
  type HabitLogLike,
  type HabitTradePair,
  interpretCoefficient,
  MIN_CORRELATION_PAIRS,
  pairHabitLogsToTrades,
  SUFFICIENT_SAMPLE_MIN,
  type TradeLike,
} from './habit-trade-correlation';

// Helper: synthesize pairs straight from x/y arrays (date is irrelevant to
// the coefficient — Pearson/Spearman are order/label invariant).
function mkPairs(xs: number[], ys: number[]): HabitTradePair[] {
  return xs.map((x, i) => ({
    date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
    habitValue: x,
    realizedR: ys[i]!,
  }));
}

describe('extractHabitScalar', () => {
  it('sleep: durationMin -> hours', () => {
    expect(extractHabitScalar('sleep', { durationMin: 420 })).toBe(7);
    expect(extractHabitScalar('sleep', { durationMin: 450, quality: 8 })).toBe(7.5);
  });

  it('nutrition: meals count', () => {
    expect(extractHabitScalar('nutrition', { mealsCount: 3 })).toBe(3);
    expect(extractHabitScalar('nutrition', { mealsCount: 2, quality: 'good' })).toBe(2);
  });

  it('caffeine: cups', () => {
    expect(extractHabitScalar('caffeine', { cups: 4 })).toBe(4);
    expect(extractHabitScalar('caffeine', { cups: 1, lastDrinkAtUtc: '14:30' })).toBe(1);
  });

  it('sport: duration minutes', () => {
    expect(extractHabitScalar('sport', { type: 'cardio', durationMin: 45 })).toBe(45);
  });

  it('meditation: duration minutes', () => {
    expect(extractHabitScalar('meditation', { durationMin: 20 })).toBe(20);
  });

  it('returns null on a malformed payload (never throws)', () => {
    expect(extractHabitScalar('sleep', null)).toBeNull();
    expect(extractHabitScalar('sleep', {})).toBeNull();
    expect(extractHabitScalar('sleep', { durationMin: 'eight' })).toBeNull();
    expect(extractHabitScalar('caffeine', { cups: -1 })).toBeNull();
    expect(extractHabitScalar('sport', { durationMin: 30 })).toBeNull(); // missing `type`
    expect(extractHabitScalar('nutrition', { mealsCount: 3, extra: 1 })).toBeNull(); // .strict()
  });
});

describe('interpretCoefficient', () => {
  it('weak below |0.3| (and unsigned at 0)', () => {
    expect(interpretCoefficient(0)).toBe('weak');
    expect(interpretCoefficient(0.29)).toBe('weak');
    expect(interpretCoefficient(-0.29)).toBe('weak');
  });

  it('moderate in [0.3, 0.5)', () => {
    expect(interpretCoefficient(0.3)).toBe('moderate_positive');
    expect(interpretCoefficient(0.49)).toBe('moderate_positive');
    expect(interpretCoefficient(-0.4)).toBe('moderate_negative');
  });

  it('strong at >= |0.5|', () => {
    expect(interpretCoefficient(0.5)).toBe('strong_positive');
    expect(interpretCoefficient(0.9)).toBe('strong_positive');
    expect(interpretCoefficient(-0.7)).toBe('strong_negative');
  });
});

describe('pairHabitLogsToTrades', () => {
  const tz = 'Europe/Paris';

  it('pairs a trade to the habit logged on its Paris entry day', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 420 } },
    ];
    const trades: TradeLike[] = [{ enteredAt: '2026-05-15T08:00:00Z', realizedR: 1.5 }];
    const pairs = pairHabitLogsToTrades(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([{ date: '2026-05-15', habitValue: 7, realizedR: 1.5 }]);
  });

  it('uses Paris wall-clock for the day boundary, not UTC slice', () => {
    // 2026-05-15T23:15Z is already 2026-05-16 01:15 in Paris (CEST = UTC+2).
    // A UTC slice would (wrongly) bucket this on 2026-05-15.
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-16', kind: 'sleep', value: { durationMin: 480 } },
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 300 } },
    ];
    const trades: TradeLike[] = [{ enteredAt: '2026-05-15T23:15:00Z', realizedR: 2 }];
    const pairs = pairHabitLogsToTrades(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([{ date: '2026-05-16', habitValue: 8, realizedR: 2 }]);
  });

  it('filters by kind and skips days without a matching habit log', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 420 } },
      { date: '2026-05-15', kind: 'caffeine', value: { cups: 3 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1 },
      { enteredAt: '2026-05-20T08:00:00Z', realizedR: -1 }, // no habit that day
    ];
    expect(pairHabitLogsToTrades(habitLogs, trades, 'sleep', tz)).toHaveLength(1);
    expect(pairHabitLogsToTrades(habitLogs, trades, 'caffeine', tz)).toEqual([
      { date: '2026-05-15', habitValue: 3, realizedR: 1 },
    ]);
  });

  it('skips non-finite realizedR and sorts ascending by habitValue', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-10', kind: 'sleep', value: { durationMin: 540 } }, // 9h
      { date: '2026-05-11', kind: 'sleep', value: { durationMin: 300 } }, // 5h
      { date: '2026-05-12', kind: 'sleep', value: { durationMin: 420 } }, // 7h
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-10T08:00:00Z', realizedR: 1 },
      { enteredAt: '2026-05-11T08:00:00Z', realizedR: 2 },
      { enteredAt: '2026-05-12T08:00:00Z', realizedR: Number.NaN },
    ];
    const pairs = pairHabitLogsToTrades(habitLogs, trades, 'sleep', tz);
    expect(pairs.map((p) => p.habitValue)).toEqual([5, 9]); // sorted, NaN row dropped
  });

  it('a multi-trade day yields one pair per trade (same x, different y)', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 360 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1 },
      { enteredAt: '2026-05-15T13:00:00Z', realizedR: -2 },
    ];
    const pairs = pairHabitLogsToTrades(habitLogs, trades, 'sleep', tz);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.habitValue === 6)).toBe(true);
  });
});

describe('computeHabitTradeCorrelation', () => {
  it('insufficient_data when n = 0', () => {
    const res = computeHabitTradeCorrelation([], 'sleep', 30, []);
    expect(res.correlation).toEqual({
      status: 'insufficient_data',
      n: 0,
      minRequired: MIN_CORRELATION_PAIRS,
    });
    expect(MIN_CORRELATION_PAIRS).toBe(8);
  });

  it('still insufficient at exactly 7 pairs (one below the floor)', () => {
    const pairs = mkPairs([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7]);
    const res = computeHabitTradeCorrelation(pairs, 'sleep', 30, []);
    expect(res.correlation.status).toBe('insufficient_data');
  });

  it('sufficient at exactly 8 pairs, confidence "low" below SUFFICIENT_SAMPLE_MIN', () => {
    const pairs = mkPairs([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 16]);
    const res = computeHabitTradeCorrelation(pairs, 'sleep', 30, []);
    expect(res.correlation.status).toBe('sufficient');
    if (res.correlation.status !== 'sufficient') throw new Error('unreachable');
    expect(res.correlation.n).toBe(8);
    expect(res.correlation.r).toBeCloseTo(1, 12);
    expect(res.correlation.rSpearman).toBeCloseTo(1, 12);
    expect(res.correlation.confidence).toBe('low');
    expect(res.correlation.interpretation).toBe('strong_positive');
    expect(SUFFICIENT_SAMPLE_MIN).toBe(20);
  });

  it('confidence "adequate" at >= SUFFICIENT_SAMPLE_MIN pairs', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const res = computeHabitTradeCorrelation(mkPairs(xs, xs), 'sleep', 30, []);
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.n).toBe(20);
    expect(res.correlation.confidence).toBe('adequate');
  });

  it('matches the scipy Pearson golden value (n=10)', () => {
    // scipy.stats.pearsonr([1..10], [2,1,4,3,6,5,8,7,10,9]) -> 0.9393939393939394
    const pairs = mkPairs([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]);
    const res = computeHabitTradeCorrelation(pairs, 'sleep', 30, []);
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.r).toBeCloseTo(0.9393939393939394, 10);
    expect(res.correlation.interpretation).toBe('strong_positive');
    expect(res.correlation.confidence).toBe('low'); // 10 < 20
  });

  it('insufficient_data when Pearson is undefined (zero variance in y)', () => {
    const pairs = mkPairs([1, 2, 3, 4, 5, 6, 7, 8], [3, 3, 3, 3, 3, 3, 3, 3]);
    const res = computeHabitTradeCorrelation(pairs, 'sleep', 30, []);
    expect(res.correlation.status).toBe('insufficient_data');
  });

  it('carries habitKind, windowDays and heatmap through unchanged', () => {
    const heatmap = [{ date: '2026-05-16' as const, kinds: { sleep: true } }];
    const res = computeHabitTradeCorrelation([], 'caffeine', 14, heatmap);
    expect(res.habitKind).toBe('caffeine');
    expect(res.windowDays).toBe(14);
    expect(res.heatmap).toEqual(heatmap);
  });
});

describe('buildHabitHeatmap', () => {
  it('always returns exactly `days` entries, newest-first', () => {
    const grid = buildHabitHeatmap([], '2026-05-16', 7);
    expect(grid).toHaveLength(7);
    expect(grid[0]!.date).toBe('2026-05-16'); // today first
    expect(grid[1]!.date).toBe('2026-05-15'); // yesterday
    expect(grid[6]!.date).toBe('2026-05-10');
    // empty logs -> no kinds flagged
    expect(grid.every((d) => Object.keys(d.kinds).length === 0)).toBe(true);
  });

  it('marks the kinds logged on each day', () => {
    const logs: HabitLogLike[] = [
      { date: '2026-05-16', kind: 'sleep', value: { durationMin: 420 } },
      { date: '2026-05-16', kind: 'caffeine', value: { cups: 2 } },
      { date: '2026-05-14', kind: 'sport', value: { type: 'cardio', durationMin: 30 } },
    ];
    const grid = buildHabitHeatmap(logs, '2026-05-16', 7);
    expect(grid[0]!.kinds).toEqual({ sleep: true, caffeine: true });
    expect(grid[2]!.date).toBe('2026-05-14');
    expect(grid[2]!.kinds).toEqual({ sport: true });
    // a day with no logs stays empty
    expect(grid[1]!.kinds).toEqual({});
  });

  it('ignores logs outside the window', () => {
    const logs: HabitLogLike[] = [
      { date: '2026-04-01', kind: 'sleep', value: { durationMin: 420 } },
    ];
    const grid = buildHabitHeatmap(logs, '2026-05-16', 7);
    expect(grid.every((d) => Object.keys(d.kinds).length === 0)).toBe(true);
  });
});
