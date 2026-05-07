import { describe, expect, it } from 'vitest';

import { buildEquityCurve, type EquityCurveTradeInput } from './equity-curve';

const T = (
  r: number | null,
  ts = '2026-01-01T10:00:00Z',
  source: 'computed' | 'estimated' | null = 'computed',
  outcome: 'win' | 'loss' | 'break_even' | null = r === null
    ? null
    : r > 0
      ? 'win'
      : r < 0
        ? 'loss'
        : 'break_even',
  closed = true,
): EquityCurveTradeInput => ({
  outcome,
  realizedR: r === null ? null : String(r),
  realizedRSource: source,
  exitedAt: closed ? ts : null,
  closedAt: closed ? ts : null,
});

describe('buildEquityCurve', () => {
  it('returns an empty curve on empty input', () => {
    const r = buildEquityCurve([]);
    expect(r.points).toEqual([]);
    expect(r.estimatedExcluded).toBe(0);
    expect(r.invalidExcluded).toBe(0);
  });

  it('builds the cumulative R correctly', () => {
    const trades = [
      T(1, '2026-01-01T10:00:00Z'),
      T(-2, '2026-01-02T10:00:00Z'),
      T(3, '2026-01-03T10:00:00Z'),
      T(-1, '2026-01-04T10:00:00Z'),
    ];
    const { points } = buildEquityCurve(trades);
    expect(points.map((p) => p.cumR)).toEqual([1, -1, 2, 1]);
  });

  it('tracks drawdown from peak in R', () => {
    // Cum: 1, 3 (peak), 2, 0 (DD=3), 1
    const trades = [
      T(1, '2026-01-01T10:00:00Z'),
      T(2, '2026-01-02T10:00:00Z'),
      T(-1, '2026-01-03T10:00:00Z'),
      T(-2, '2026-01-04T10:00:00Z'),
      T(1, '2026-01-05T10:00:00Z'),
    ];
    const { points } = buildEquityCurve(trades);
    expect(points.map((p) => p.drawdownFromPeak)).toEqual([0, 0, 1, 3, 2]);
  });

  it('sorts trades chronologically before accumulating', () => {
    const trades = [
      T(3, '2026-01-03T10:00:00Z'),
      T(1, '2026-01-01T10:00:00Z'),
      T(-2, '2026-01-02T10:00:00Z'),
    ];
    const { points } = buildEquityCurve(trades);
    expect(points.map((p) => p.cumR)).toEqual([1, -1, 2]);
  });

  it('falls back to closedAt when exitedAt is null', () => {
    const trades: EquityCurveTradeInput[] = [
      {
        outcome: 'win',
        realizedR: '1.5',
        realizedRSource: 'computed',
        exitedAt: null,
        closedAt: '2026-01-01T10:00:00Z',
      },
    ];
    const { points } = buildEquityCurve(trades);
    expect(points).toHaveLength(1);
    expect(points[0]!.ts).toBe('2026-01-01T10:00:00Z');
    expect(points[0]!.cumR).toBe(1.5);
  });

  it('skips open trades (closedAt = null)', () => {
    const trades = [
      T(1, '2026-01-01T10:00:00Z'),
      T(1, '2026-01-02T10:00:00Z', 'computed', 'win', false),
    ];
    const { points } = buildEquityCurve(trades);
    expect(points).toHaveLength(1);
  });

  it('excludes estimated-source trades and reports the count', () => {
    const trades = [
      T(1, '2026-01-01T10:00:00Z', 'computed'),
      T(99, '2026-01-02T10:00:00Z', 'estimated'),
      T(2, '2026-01-03T10:00:00Z', 'computed'),
    ];
    const r = buildEquityCurve(trades);
    expect(r.points.map((p) => p.cumR)).toEqual([1, 3]);
    expect(r.estimatedExcluded).toBe(1);
    expect(r.invalidExcluded).toBe(0);
  });

  it('reports invalidExcluded when realizedR is null or NaN', () => {
    const trades: EquityCurveTradeInput[] = [
      T(1, '2026-01-01T10:00:00Z'),
      {
        outcome: 'win',
        realizedR: null,
        realizedRSource: 'computed',
        exitedAt: '2026-01-02T10:00:00Z',
        closedAt: '2026-01-02T10:00:00Z',
      },
      {
        outcome: 'loss',
        realizedR: 'oops',
        realizedRSource: 'computed',
        exitedAt: '2026-01-03T10:00:00Z',
        closedAt: '2026-01-03T10:00:00Z',
      },
    ];
    const r = buildEquityCurve(trades);
    expect(r.points).toHaveLength(1);
    expect(r.invalidExcluded).toBe(2);
  });

  it('preserves the input ISO timestamp in each point', () => {
    const trades = [T(1, '2026-01-01T10:30:00Z'), T(2, '2026-01-02T15:00:00Z')];
    const { points } = buildEquityCurve(trades);
    expect(points[0]!.ts).toBe('2026-01-01T10:30:00Z');
    expect(points[1]!.ts).toBe('2026-01-02T15:00:00Z');
  });
});
