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

  it('drops the leading partial-month label when it would overlap the next one', () => {
    // today Thu 2026-07-02 → first column is Monday 2025-06-30: a 1-column June
    // stub whose label sat 1 column (14px) before « juil. » — the two rendered
    // superposed on /progression (prod audit 2026-07-02). The partial leading
    // label is dropped; the first visible label is July at column 1.
    const hm = buildYearHeatmap(new Map(), '2026-07-02');
    expect(hm.monthLabels[0]).toEqual({ col: 1, label: 'juil.' });
    // Anti-overlap invariant: no adjacent labels closer than 3 columns.
    for (let i = 1; i < hm.monthLabels.length; i++) {
      expect(hm.monthLabels[i]!.col - hm.monthLabels[i - 1]!.col).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the leading label when the first month segment is wide enough', () => {
    // today Sat 2026-06-20 → first column is Monday 2025-06-16: June owns 3
    // columns before « juil. » (42px pitch ≥ label width) — nothing dropped.
    const hm = buildYearHeatmap(new Map(), today);
    expect(hm.monthLabels[0]).toEqual({ col: 0, label: 'juin' });
    expect(hm.monthLabels[1]).toEqual({ col: 3, label: 'juil.' });
  });

  it('covers ~one year back (first column is a Monday in 2025)', () => {
    const hm = buildYearHeatmap(new Map(), today);
    const first = hm.weeks[0]![0];
    expect(first).not.toBeNull();
    expect(wd(first!.date)).toBe(0); // Monday
    expect(first!.date.startsWith('2025-')).toBe(true);
  });
});
