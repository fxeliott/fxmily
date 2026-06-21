import { describe, expect, it } from 'vitest';

import {
  detectMomentum,
  MOMENTUM_DECLINE_THRESHOLD,
  MOMENTUM_MIN_POINTS,
  type MomentumHistoryPoint,
} from './momentum';

// -----------------------------------------------------------------------------
// Helpers — inline daily trend builders. A "flat" series sits at a constant
// value; a "declining" series steps down by `perDayDrop` from `start`.
// -----------------------------------------------------------------------------

function isoAddDays(startIso: string, days: number): string {
  const [y, m, d] = startIso.split('-').map(Number);
  const t = Date.UTC(y!, m! - 1, d!) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

type Dim = 'discipline' | 'emotionalStability' | 'consistency' | 'engagement';

/** Build N consecutive daily points with a chosen value-fn per dimension. */
function series(
  n: number,
  valueFor: (dim: Dim, i: number) => number | null,
  startIso = '2026-05-01',
): MomentumHistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: isoAddDays(startIso, i),
    discipline: valueFor('discipline', i),
    emotionalStability: valueFor('emotionalStability', i),
    consistency: valueFor('consistency', i),
    engagement: valueFor('engagement', i),
  }));
}

describe('detectMomentum', () => {
  it('returns [] below the minimum sample size', () => {
    const h = series(MOMENTUM_MIN_POINTS - 1, () => 80);
    expect(detectMomentum(h)).toEqual([]);
  });

  it('returns [] for a flat series (no drift)', () => {
    const h = series(20, () => 70);
    expect(detectMomentum(h)).toEqual([]);
  });

  it('returns [] for an improving series (positive slope is not a decline)', () => {
    // +1 pt/day on every dim → strongly positive.
    const h = series(20, (_dim, i) => 50 + i);
    expect(detectMomentum(h)).toEqual([]);
  });

  it('flags a sustained decline on a single dimension', () => {
    // emotionalStability drops ~1 pt/day (≈ -7/week, well past threshold);
    // the other three stay flat.
    const h = series(20, (dim, i) => (dim === 'emotionalStability' ? 90 - i : 75));
    const out = detectMomentum(h);
    expect(out).toHaveLength(1);
    expect(out[0]!.dimension).toBe('emotionalStability');
    expect(out[0]!.weeklySlope).toBeLessThanOrEqual(MOMENTUM_DECLINE_THRESHOLD);
    expect(out[0]!.points).toBe(20);
  });

  it('does NOT flag a decline gentler than the threshold', () => {
    // ~ -0.04 pt/day ≈ -0.3/week, above (gentler than) the -0.5/week threshold.
    const h = series(30, (_dim, i) => 80 - i * 0.04);
    expect(detectMomentum(h)).toEqual([]);
  });

  it('skips null points and still flags when enough remain', () => {
    // Every other day is null for consistency; the present points decline hard.
    const h = series(24, (dim, i) => {
      if (dim === 'consistency') return i % 2 === 0 ? 88 - i : null;
      return 70;
    });
    const out = detectMomentum(h);
    expect(out.map((d) => d.dimension)).toEqual(['consistency']);
    expect(out[0]!.points).toBe(12); // half the 24 days
  });

  it('returns multiple declines sorted steepest-first', () => {
    const h = series(20, (dim, i) => {
      if (dim === 'discipline') return 90 - i * 2; // steepest
      if (dim === 'engagement') return 85 - i; // gentler but still past threshold
      return 60; // others flat
    });
    const out = detectMomentum(h);
    expect(out.map((d) => d.dimension)).toEqual(['discipline', 'engagement']);
    expect(out[0]!.weeklySlope).toBeLessThan(out[1]!.weeklySlope); // most negative first
  });

  it('only measures the recent window (an old decline outside 42d is ignored)', () => {
    // 30 days of steep decline, then a 50-day gap, then 8 flat recent days.
    const oldPart = series(30, (dim) => (dim === 'discipline' ? 90 : 70));
    const declineInOld = oldPart.map((p, i) => ({ ...p, discipline: 90 - i * 2 }));
    const recent = series(8, () => 70, isoAddDays('2026-05-01', 80));
    const out = detectMomentum([...declineInOld, ...recent]);
    // The recent window (flat) carries no decline → nothing flagged.
    expect(out).toEqual([]);
  });
});
