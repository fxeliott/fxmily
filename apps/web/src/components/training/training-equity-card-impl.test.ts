import { describe, expect, it } from 'vitest';

import { buildCumulativeKept, type TrainingEquityPoint } from './training-equity-card-impl';

const pt = (enteredAt: string, systemRespected: boolean | null): TrainingEquityPoint => ({
  enteredAt,
  systemRespected,
});

describe('buildCumulativeKept', () => {
  it('counts only systemRespected === true, cumulatively (oldest → newest)', () => {
    const series = buildCumulativeKept([
      pt('2026-06-01', true),
      pt('2026-06-02', false),
      pt('2026-06-03', true),
      pt('2026-06-04', true),
    ]);
    expect(series.map((s) => s.kept)).toEqual([1, 1, 2, 3]);
    expect(series.map((s) => s.idx)).toEqual([1, 2, 3, 4]);
  });

  it('sorts unordered input by enteredAt before accumulating', () => {
    const series = buildCumulativeKept([
      pt('2026-06-04', true),
      pt('2026-06-01', true),
      pt('2026-06-03', false),
      pt('2026-06-02', true),
    ]);
    // Chronological: 01(true)=1, 02(true)=2, 03(false)=2, 04(true)=3
    expect(series.map((s) => s.kept)).toEqual([1, 2, 2, 3]);
  });

  it('null answers never increment AND never decrement (curve only rises/plateaus)', () => {
    const series = buildCumulativeKept([
      pt('2026-06-01', true),
      pt('2026-06-02', null),
      pt('2026-06-03', null),
      pt('2026-06-04', true),
    ]);
    expect(series.map((s) => s.kept)).toEqual([1, 1, 1, 2]);
    // Monotonic non-decreasing — anti-Black-Hat: a bad day is a plateau, never a drop.
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.kept).toBeGreaterThanOrEqual(series[i - 1]!.kept);
    }
  });

  it('empty input → empty series (calm empty state upstream, no fabricated point)', () => {
    expect(buildCumulativeKept([])).toEqual([]);
  });

  it('all-false → flat zero (never a negative or fabricated value)', () => {
    const series = buildCumulativeKept([pt('2026-06-01', false), pt('2026-06-02', false)]);
    expect(series.map((s) => s.kept)).toEqual([0, 0]);
  });
});
