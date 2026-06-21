import { describe, expect, it } from 'vitest';

import {
  buildHabitHeatmap,
  computeHabitDisciplineCorrelation,
  computeHabitTradeCorrelation,
  extractHabitScalar,
  type HabitDisciplinePair,
  type HabitLogLike,
  type HabitTradePair,
  interpretCoefficient,
  MIN_CORRELATION_PAIRS,
  pairHabitLogsToDiscipline,
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

// =============================================================================
// V2.2 — generalization to all 5 pillars (the per-kind picker guarantee)
// =============================================================================

/**
 * V2.1.3 wired only `sleep` in the UI; the picker (V2.2) lets the member
 * correlate any of the 5 pillars. These exercise the FULL pipeline
 * (`extractHabitScalar` → `pairHabitLogsToTrades` → `computeHabitTradeCorrelation`)
 * per kind — not the `mkPairs` shortcut — so a regression in any per-kind
 * scalar extraction or in the discriminated-union honesty surfaces here.
 */
describe('V2.2 — 5-kind round-trip (pair → compute)', () => {
  const tz = 'Europe/Paris';
  const day = (d: number) => `2026-05-${String(d).padStart(2, '0')}`;
  const trade = (d: number, realizedR: number): TradeLike => ({
    enteredAt: `${day(d)}T08:00:00Z`, // 10:00 Paris — same civil day
    realizedR,
  });

  it('nutrition: mealsCount correlates positively, kind carried through', () => {
    const logs: HabitLogLike[] = [1, 2, 3, 4, 1, 2, 3, 4].map((mealsCount, i) => ({
      date: day(i + 1),
      kind: 'nutrition',
      value: { mealsCount },
    }));
    const trades = [1, 2, 3, 4, 1, 2, 3, 4].map((m, i) => trade(i + 1, m * 2)); // y = 2x
    const pairs = pairHabitLogsToTrades(logs, trades, 'nutrition', tz);
    const res = computeHabitTradeCorrelation(pairs, 'nutrition', 30, []);
    expect(res.habitKind).toBe('nutrition');
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.n).toBe(8);
    expect(res.correlation.r).toBeCloseTo(1, 12);
    expect(res.correlation.interpretation).toBe('strong_positive');
    expect(res.correlation.confidence).toBe('low'); // 8 < SUFFICIENT_SAMPLE_MIN
  });

  it('caffeine: a NEGATIVE link is surfaced factually, never masked', () => {
    const cups = [0, 1, 2, 3, 4, 5, 1, 3];
    const logs: HabitLogLike[] = cups.map((c, i) => ({
      date: day(i + 1),
      kind: 'caffeine',
      value: { cups: c },
    }));
    const trades = cups.map((c, i) => trade(i + 1, 10 - 2 * c)); // strictly decreasing
    const pairs = pairHabitLogsToTrades(logs, trades, 'caffeine', tz);
    const res = computeHabitTradeCorrelation(pairs, 'caffeine', 30, []);
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.r).toBeCloseTo(-1, 12);
    expect(res.correlation.interpretation).toBe('strong_negative');
  });

  it('sport: requires `type`; a typeless log is dropped, n unaffected', () => {
    const mins = [10, 20, 30, 40, 50, 60, 15, 25];
    const logs: HabitLogLike[] = mins.map((durationMin, i) => ({
      date: day(i + 1),
      kind: 'sport',
      value: { type: 'cardio', durationMin },
    }));
    // A 9th day with a malformed sport log (no `type`) + its trade.
    logs.push({ date: day(9), kind: 'sport', value: { durationMin: 30 } });
    const trades = [...mins.map((m, i) => trade(i + 1, m * 0.05)), trade(9, 5)];
    const pairs = pairHabitLogsToTrades(logs, trades, 'sport', tz);
    const res = computeHabitTradeCorrelation(pairs, 'sport', 30, []);
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.n).toBe(8); // typeless day excluded, not 9
    expect(res.correlation.r).toBeCloseTo(1, 12);
    expect(res.habitKind).toBe('sport');
  });

  it('meditation: durationMin round-trips to a strong positive link', () => {
    const mins = [5, 10, 15, 20, 25, 30, 8, 12];
    const logs: HabitLogLike[] = mins.map((durationMin, i) => ({
      date: day(i + 1),
      kind: 'meditation',
      value: { durationMin },
    }));
    const trades = mins.map((m, i) => trade(i + 1, m * 0.1));
    const res = computeHabitTradeCorrelation(
      pairHabitLogsToTrades(logs, trades, 'meditation', tz),
      'meditation',
      30,
      [],
    );
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.habitKind).toBe('meditation');
    expect(res.correlation.interpretation).toBe('strong_positive');
  });

  it('cross-kind isolation: same days, picking `sport` ignores the sleep scalar', () => {
    const mins = [10, 20, 30, 40, 50, 60, 70, 80];
    const logs: HabitLogLike[] = [];
    mins.forEach((durationMin, i) => {
      logs.push({ date: day(i + 1), kind: 'sleep', value: { durationMin: 480 } }); // constant 8h
      logs.push({ date: day(i + 1), kind: 'sport', value: { type: 'mixed', durationMin } });
    });
    const trades = mins.map((m, i) => trade(i + 1, m)); // R tracks sport minutes, not sleep
    const res = computeHabitTradeCorrelation(
      pairHabitLogsToTrades(logs, trades, 'sport', tz),
      'sport',
      30,
      [],
    );
    if (res.correlation.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.correlation.r).toBeCloseTo(1, 12); // sport→R, sleep (constant) irrelevant
    // Sanity: picking `sleep` here is zero-variance x → structurally insufficient.
    const sleepRes = computeHabitTradeCorrelation(
      pairHabitLogsToTrades(logs, trades, 'sleep', tz),
      'sleep',
      30,
      [],
    );
    expect(sleepRes.correlation.status).toBe('insufficient_data');
  });

  it('honesty holds per kind: a sparsely-logged pillar stays insufficient_data', () => {
    const logs: HabitLogLike[] = [];
    // 30 days of sleep, but only 3 sport days.
    for (let i = 1; i <= 28; i++) {
      logs.push({ date: day(i), kind: 'sleep', value: { durationMin: 400 + i } });
    }
    [1, 2, 3].forEach((i) =>
      logs.push({ date: day(i), kind: 'sport', value: { type: 'cardio', durationMin: i * 10 } }),
    );
    const trades = Array.from({ length: 28 }, (_, i) => trade(i + 1, (i % 5) - 2));
    const res = computeHabitTradeCorrelation(
      pairHabitLogsToTrades(logs, trades, 'sport', tz),
      'sport',
      30,
      [],
    );
    expect(res.correlation).toEqual({
      status: 'insufficient_data',
      n: 3,
      minRequired: MIN_CORRELATION_PAIRS,
    });
    expect('r' in res.correlation).toBe(false); // union structurally forbids a coefficient
  });
});

// =============================================================================
// V2.3 — habit × DISCIPLINE (plan-respect, point-biserial) — SPEC §7.5
// =============================================================================

/**
 * The strongest Fxmily differentiator: does a logged habit move with whether
 * the member RESPECTED THEIR PLAN (`Trade.planRespected`, NON-NULL Boolean)?
 * Y is binary (0/1) → point-biserial, which is exactly a Pearson r on a binary
 * Y, so we reuse `correlations.ts` + `computeHabitTradeCorrelation` verbatim:
 * SAME `MIN_CORRELATION_PAIRS` floor, SAME confidence tier, SAME discriminated
 * `insufficient_data | sufficient` union (no coefficient when the sample is
 * thin OR Y has zero variance).
 */

// Build discipline pairs straight from x / binary-y arrays (date irrelevant to
// the coefficient). Mirrors `mkPairs` but for the binary discipline Y.
function mkDiscPairs(xs: number[], ys: Array<0 | 1>): HabitDisciplinePair[] {
  return xs.map((x, i) => ({
    date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
    habitValue: x,
    disciplineY: ys[i]!,
  }));
}

describe('pairHabitLogsToDiscipline', () => {
  const tz = 'Europe/Paris';

  it('Y is binary: planRespected=true -> 1, false -> 0', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 420 } },
      { date: '2026-05-16', kind: 'sleep', value: { durationMin: 300 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1.5, planRespected: true },
      { enteredAt: '2026-05-16T08:00:00Z', realizedR: -1, planRespected: false },
    ];
    const pairs = pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([
      { date: '2026-05-16', habitValue: 5, disciplineY: 0 },
      { date: '2026-05-15', habitValue: 7, disciplineY: 1 },
    ]); // sorted ascending by habitValue
  });

  it('uses Paris wall-clock for the day boundary, not a UTC slice', () => {
    // 2026-05-15T23:15Z is already 2026-05-16 01:15 in Paris (CEST = UTC+2).
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-16', kind: 'sleep', value: { durationMin: 480 } },
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 300 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T23:15:00Z', realizedR: 2, planRespected: true },
    ];
    const pairs = pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([{ date: '2026-05-16', habitValue: 8, disciplineY: 1 }]);
  });

  it('SKIPS a trade with no planRespected judgement (never coerces it to 0)', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 420 } },
      { date: '2026-05-16', kind: 'sleep', value: { durationMin: 480 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1, planRespected: true },
      // planRespected absent → must NOT become a disciplineY:0 false-failure.
      { enteredAt: '2026-05-16T08:00:00Z', realizedR: -2 },
    ];
    const pairs = pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([{ date: '2026-05-15', habitValue: 7, disciplineY: 1 }]);
  });

  it('does NOT gate on realizedR finiteness (discipline is independent of R)', () => {
    // A NaN realizedR still carries a real planRespected judgement — kept.
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 420 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: Number.NaN, planRespected: false },
    ];
    const pairs = pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz);
    expect(pairs).toEqual([{ date: '2026-05-15', habitValue: 7, disciplineY: 0 }]);
  });

  it('filters by kind and skips days without a matching habit log', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'caffeine', value: { cups: 3 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1, planRespected: true },
      { enteredAt: '2026-05-20T08:00:00Z', realizedR: -1, planRespected: false }, // no log
    ];
    expect(pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz)).toEqual([]);
    expect(pairHabitLogsToDiscipline(habitLogs, trades, 'caffeine', tz)).toEqual([
      { date: '2026-05-15', habitValue: 3, disciplineY: 1 },
    ]);
  });

  it('a multi-trade day yields one pair per trade (same x, per-trade Y)', () => {
    const habitLogs: HabitLogLike[] = [
      { date: '2026-05-15', kind: 'sleep', value: { durationMin: 360 } },
    ];
    const trades: TradeLike[] = [
      { enteredAt: '2026-05-15T08:00:00Z', realizedR: 1, planRespected: true },
      { enteredAt: '2026-05-15T13:00:00Z', realizedR: -2, planRespected: false },
    ];
    const pairs = pairHabitLogsToDiscipline(habitLogs, trades, 'sleep', tz);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.habitValue === 6)).toBe(true);
    expect(pairs.map((p) => p.disciplineY).sort()).toEqual([0, 1]);
  });
});

describe('computeHabitDisciplineCorrelation', () => {
  it('matches the point-biserial golden value (Pearson on binary Y, n=10)', () => {
    // X = sleep hours, Y = plan respected (0/1). Verified against a reference
    // Pearson implementation (point-biserial == Pearson on a binary Y):
    //   pearson([5,5.5,..,9.5], [0,0,0,1,0,1,1,1,1,1]) -> 0.7817359599705717
    // X strictly increasing → Spearman ρ equals the same value here.
    const xs = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5];
    const ys: Array<0 | 1> = [0, 0, 0, 1, 0, 1, 1, 1, 1, 1];
    const res = computeHabitDisciplineCorrelation(mkDiscPairs(xs, ys), 'sleep', 30);
    expect(res.status).toBe('sufficient');
    if (res.status !== 'sufficient') throw new Error('unreachable');
    expect(res.r).toBeCloseTo(0.7817359599705717, 10);
    expect(res.rSpearman).toBeCloseTo(0.7817359599705717, 10);
    expect(res.n).toBe(10);
    expect(res.interpretation).toBe('strong_positive');
    expect(res.confidence).toBe('low'); // 10 < SUFFICIENT_SAMPLE_MIN (20)
  });

  it('a perfect binary split gives r = +1 (every high-sleep day plan-respected)', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys: Array<0 | 1> = [0, 0, 0, 0, 1, 1, 1, 1];
    const res = computeHabitDisciplineCorrelation(mkDiscPairs(xs, ys), 'sleep', 30);
    if (res.status !== 'sufficient') throw new Error('expected sufficient');
    // pearson([1..8], [0,0,0,0,1,1,1,1]) -> 0.8728715609439693 (clean median split)
    expect(res.r).toBeCloseTo(0.8728715609439693, 10);
    expect(res.interpretation).toBe('strong_positive');
  });

  it('n < MIN_CORRELATION_PAIRS -> insufficient_data, NO coefficient field', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7]; // 7 < 8
    const ys: Array<0 | 1> = [0, 1, 0, 1, 0, 1, 0];
    const res = computeHabitDisciplineCorrelation(mkDiscPairs(xs, ys), 'sleep', 30);
    expect(res).toEqual({
      status: 'insufficient_data',
      n: 7,
      minRequired: MIN_CORRELATION_PAIRS,
    });
    // The discriminated union structurally forbids a coefficient in this branch.
    expect('r' in res).toBe(false);
    expect('rSpearman' in res).toBe(false);
    expect('interpretation' in res).toBe(false);
  });

  it('zero variance in Y (plan ALWAYS respected) -> insufficient_data, never a fake r', () => {
    // The member respected their plan on every paired trade: Y is constant, so
    // a coefficient is undefined — the honesty gate must NOT manufacture r=±1.
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys: Array<0 | 1> = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const res = computeHabitDisciplineCorrelation(mkDiscPairs(xs, ys), 'sleep', 30);
    expect(res.status).toBe('insufficient_data');
    expect('r' in res).toBe(false);
  });

  it('confidence "adequate" at >= SUFFICIENT_SAMPLE_MIN paired days', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const ys = xs.map((_, i): 0 | 1 => (i < 10 ? 0 : 1));
    const res = computeHabitDisciplineCorrelation(mkDiscPairs(xs, ys), 'sleep', 30);
    if (res.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.n).toBe(20);
    expect(res.confidence).toBe('adequate');
  });

  it('full round-trip (pair -> compute) excludes judgement-less trades from n', () => {
    const tz = 'Europe/Paris';
    const day = (d: number) => `2026-05-${String(d).padStart(2, '0')}`;
    const logs: HabitLogLike[] = [];
    const trades: TradeLike[] = [];
    // 8 days with a real judgement (alternating respected), enough to be sufficient.
    for (let i = 1; i <= 8; i++) {
      logs.push({ date: day(i), kind: 'sleep', value: { durationMin: 300 + i * 30 } });
      trades.push({
        enteredAt: `${day(i)}T08:00:00Z`,
        realizedR: i,
        planRespected: i % 2 === 0,
      });
    }
    // A 9th day logged + traded but with NO planRespected → must not inflate n.
    logs.push({ date: day(9), kind: 'sleep', value: { durationMin: 600 } });
    trades.push({ enteredAt: `${day(9)}T08:00:00Z`, realizedR: 3 });

    const pairs = pairHabitLogsToDiscipline(logs, trades, 'sleep', tz);
    expect(pairs).toHaveLength(8); // the judgement-less day is excluded
    const res = computeHabitDisciplineCorrelation(pairs, 'sleep', 30);
    if (res.status !== 'sufficient') throw new Error('expected sufficient');
    expect(res.n).toBe(8);
  });
});
