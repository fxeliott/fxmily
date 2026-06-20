import { describe, expect, it } from 'vitest';

import { buildYearHeatmap, type HeatLevel } from './year-heatmap';

const wd = (d: string) => (new Date(d + 'T00:00:00.000Z').getUTCDay() + 6) % 7; // Mon=0..Sun=6

describe('buildYearHeatmap', () => {
  const today = '2026-06-20'; // Saturday

  it('produces 53 week-columns of 7 weekday-rows', () => {
    const hm = buildYearHeatmap(new Map(), today);
    expect(hm.weeks).toHaveLength(53);
    for (const col of hm.weeks) expect(col).toHaveLength(7);
  });

  it('places each non-null cell on its correct weekday row (Monday-first)', () => {
    const hm = buildYearHeatmap(new Map(), today);
    for (const col of hm.weeks) {
      col.forEach((cell, row) => {
        if (cell) expect(wd(cell.date)).toBe(row);
      });
    }
  });

  it('puts today in the last column and nulls the trailing future days', () => {
    const hm = buildYearHeatmap(new Map(), today);
    const lastCol = hm.weeks[52]!;
    expect(lastCol[wd(today)]?.date).toBe(today);
    // 2026-06-21 (Sunday) is after today → null placeholder.
    expect(lastCol[6]).toBeNull();
  });

  it('maps levels and counts active days (empty days never counted)', () => {
    const levels = new Map<string, HeatLevel>([
      ['2026-06-20', 2],
      ['2026-06-19', 1],
      ['2025-12-25', 2],
    ]);
    const hm = buildYearHeatmap(levels, today);
    expect(hm.weeks[52]![wd('2026-06-20')]?.level).toBe(2);
    expect(hm.weeks[52]![wd('2026-06-19')]?.level).toBe(1);
    expect(hm.activeDays).toBe(3);
  });

  it('emits month tick labels across the range', () => {
    const hm = buildYearHeatmap(new Map(), today);
    expect(hm.monthLabels.length).toBeGreaterThanOrEqual(11);
    expect(hm.monthLabels.every((m) => typeof m.label === 'string' && m.col >= 0)).toBe(true);
  });

  it('covers ~one year back (first column is a Monday in 2025)', () => {
    const hm = buildYearHeatmap(new Map(), today);
    const first = hm.weeks[0]![0];
    expect(first).not.toBeNull();
    expect(wd(first!.date)).toBe(0); // Monday
    expect(first!.date.startsWith('2025-')).toBe(true);
  });
});
