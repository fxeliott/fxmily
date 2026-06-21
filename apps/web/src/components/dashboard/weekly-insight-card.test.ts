import { describe, expect, it } from 'vitest';

import {
  computeWeeklyInsight,
  MIN_INSIGHT_DAYS,
  type WeeklyScorePoint,
} from './weekly-insight-card';

// -----------------------------------------------------------------------------
// Helpers (inline, like habit-trade-correlation.test.ts) — synthesize trend
// points. The aggregator is order-aware (earlier vs later half) but date-label
// agnostic, so we generate sequential `YYYY-MM-DD` anchors purely for shape.
// -----------------------------------------------------------------------------

/** Build a point; any omitted dimension defaults to `null` (insufficient_data
 *  on that day) — exactly how the real series carries gaps. */
function pt(
  i: number,
  dims: Partial<
    Pick<WeeklyScorePoint, 'discipline' | 'emotionalStability' | 'consistency' | 'engagement'>
  >,
): WeeklyScorePoint {
  return {
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    discipline: dims.discipline ?? null,
    emotionalStability: dims.emotionalStability ?? null,
    consistency: dims.consistency ?? null,
    engagement: dims.engagement ?? null,
  };
}

/** A full week where one dimension follows the given per-day values. */
function weekOf(
  dim: keyof Omit<WeeklyScorePoint, 'date'>,
  vals: (number | null)[],
): WeeklyScorePoint[] {
  return vals.map((v, i) => pt(i, { [dim]: v }));
}

describe('computeWeeklyInsight — sample-size honesty', () => {
  it('insufficient when the history is empty', () => {
    const res = computeWeeklyInsight([]);
    expect(res.kind).toBe('insufficient');
    if (res.kind !== 'insufficient') throw new Error('unreachable');
    expect(res.daysWithData).toBe(0);
    expect(res.minDays).toBe(MIN_INSIGHT_DAYS);
    expect(MIN_INSIGHT_DAYS).toBe(3);
  });

  it('insufficient at exactly MIN_INSIGHT_DAYS − 1 scored days (one below floor)', () => {
    // 2 days carry a score, the rest are all-null (insufficient_data days).
    const history = [pt(0, { discipline: 60 }), pt(1, { discipline: 62 }), pt(2, {}), pt(3, {})];
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('insufficient');
    if (res.kind !== 'insufficient') throw new Error('unreachable');
    expect(res.daysWithData).toBe(2);
  });

  it('all-null days are NEVER read as zero (a null week stays insufficient)', () => {
    const history = Array.from({ length: 7 }, (_, i) => pt(i, {}));
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('insufficient');
    if (res.kind !== 'insufficient') throw new Error('unreachable');
    expect(res.daysWithData).toBe(0);
    // The forbidden fields of the scored branches must NOT exist here.
    expect('delta' in res).toBe(false);
    expect('average' in res).toBe(false);
    expect('dimension' in res).toBe(false);
  });
});

describe('computeWeeklyInsight — rising branch', () => {
  it('detects a clearly rising dimension (later half > earlier half)', () => {
    // discipline earlier half [50,52,54] avg 52, later half [70,72,74] avg 72
    // → delta = +20 → rising. (7 pts: mid=3, earlier=4, later=3.)
    const history = weekOf('discipline', [50, 52, 54, 56, 70, 72, 74]);
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('rising');
    if (res.kind !== 'rising') throw new Error('unreachable');
    expect(res.dimension).toBe('discipline');
    expect(res.label).toBe('Discipline');
    expect(res.delta).toBeGreaterThan(0);
    // earlier=[50,52,54,56] avg 53; later=[70,72,74] avg 72 → delta 19.
    expect(res.delta).toBe(19);
    // weekly avg of all 7 = (50+52+54+56+70+72+74)/7 = 61.14 → 61.
    expect(res.average).toBe(61);
  });

  it('picks the LARGEST positive delta across dimensions', () => {
    // discipline rises +10, engagement rises +30 → engagement wins.
    const history = [
      pt(0, { discipline: 50, engagement: 40 }),
      pt(1, { discipline: 51, engagement: 41 }),
      pt(2, { discipline: 52, engagement: 42 }),
      pt(3, { discipline: 53, engagement: 43 }),
      pt(4, { discipline: 60, engagement: 70 }),
      pt(5, { discipline: 61, engagement: 71 }),
      pt(6, { discipline: 62, engagement: 72 }),
    ];
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('rising');
    if (res.kind !== 'rising') throw new Error('unreachable');
    expect(res.dimension).toBe('engagement');
    expect(res.label).toBe('Engagement');
  });
});

describe('computeWeeklyInsight — steady branch (flat / declining)', () => {
  it('a flat week yields a steady highlight, never a "rising" claim', () => {
    // perfectly flat discipline at 65 → delta ≈ 0 → steady on discipline.
    const history = weekOf('discipline', [65, 65, 65, 65, 65, 65, 65]);
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('steady');
    if (res.kind !== 'steady') throw new Error('unreachable');
    expect(res.dimension).toBe('discipline');
    expect(res.average).toBe(65);
    // A flat/steady insight must NOT leak a delta (no fabricated trend).
    expect('delta' in res).toBe(false);
  });

  it('a DECLINING week is reframed as steady (anti-Black-Hat: no "down" verdict)', () => {
    // discipline falls 80→50. Never surfaced as a negative; the steady branch
    // highlights the strongest weekly average instead — no punitive copy path.
    const history = weekOf('discipline', [80, 76, 72, 68, 60, 55, 50]);
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('steady');
    if (res.kind !== 'steady') throw new Error('unreachable');
    expect(res.dimension).toBe('discipline');
    // No rising/down fields — the union forbids a delta on the steady branch.
    expect('delta' in res).toBe(false);
    // Weekly avg = (80+76+72+68+60+55+50)/7 = 65.857… → 66.
    expect(res.average).toBe(66);
  });

  it('steady picks the dimension with the highest weekly average', () => {
    // discipline avg ~40, consistency avg ~75, both flat → consistency wins.
    const history = [
      pt(0, { discipline: 40, consistency: 75 }),
      pt(1, { discipline: 41, consistency: 74 }),
      pt(2, { discipline: 39, consistency: 76 }),
      pt(3, { discipline: 40, consistency: 75 }),
      pt(4, { discipline: 41, consistency: 74 }),
      pt(5, { discipline: 39, consistency: 76 }),
      pt(6, { discipline: 40, consistency: 75 }),
    ];
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('steady');
    if (res.kind !== 'steady') throw new Error('unreachable');
    expect(res.dimension).toBe('consistency');
    expect(res.label).toBe('Cohérence');
    expect(res.average).toBe(75);
  });
});

describe('computeWeeklyInsight — robustness', () => {
  it('a thin per-half sample is too thin for a trend → steady, never rising', () => {
    // 4 scored days (≥ MIN_INSIGHT_DAYS) but the later half holds only ONE
    // discipline value (90), the rest are null. MIN_PER_HALF (2) not met in the
    // later half → no rising claim despite the late jump. (7 pts: mid=3,
    // earlier=4 → [50,52,54,56], later=3 → only index 6 scored.)
    const history = [
      pt(0, { discipline: 50 }),
      pt(1, { discipline: 52 }),
      pt(2, { discipline: 54 }),
      pt(3, { discipline: 56 }),
      pt(4, {}),
      pt(5, {}),
      pt(6, { discipline: 90 }),
    ];
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('steady'); // not 'rising' — later half has < 2 values
    if (res.kind !== 'steady') throw new Error('unreachable');
    expect(res.dimension).toBe('discipline');
    expect('delta' in res).toBe(false);
  });

  it('uses only the most recent 7 points (older history is sliced off)', () => {
    // 9 days: the first 2 (high discipline) must be ignored; only the last 7
    // (flat 60) drive the insight.
    const history = [
      pt(0, { discipline: 99 }),
      pt(1, { discipline: 99 }),
      ...weekOf('discipline', [60, 60, 60, 60, 60, 60, 60]).map((p, i) => ({
        ...p,
        date: `2026-06-${String(i + 3).padStart(2, '0')}`,
      })),
    ];
    const res = computeWeeklyInsight(history);
    expect(res.kind).toBe('steady');
    if (res.kind !== 'steady') throw new Error('unreachable');
    expect(res.average).toBe(60); // 99s excluded by the slice(-7)
  });

  it('ignores NaN/Infinity defensively (never poisons an average)', () => {
    const history = weekOf('discipline', [
      60,
      Number.NaN,
      62,
      Number.POSITIVE_INFINITY,
      64,
      66,
      68,
    ]);
    const res = computeWeeklyInsight(history);
    // 5 finite scored days ≥ MIN_INSIGHT_DAYS, all finite values averaged.
    expect(res.kind === 'rising' || res.kind === 'steady').toBe(true);
    if (res.kind === 'insufficient') throw new Error('expected a scored insight');
    // avg of finite [60,62,64,66,68] = 64.
    expect(res.average).toBe(64);
  });
});
