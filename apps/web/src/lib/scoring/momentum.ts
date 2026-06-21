/**
 * S15 #6 — PURE momentum detection over the behavioral-score history.
 *
 * The app draws today's gauges and (for discipline only) a fan-chart projection,
 * but nothing tells a member "your emotional stability has been drifting down for
 * a few weeks". A slow decline is exactly the signal only the data can see, and
 * the moment a calm nudge changes a trajectory.
 *
 * DB-free + deterministic → Vitest-testable without `server-only`. The consumer
 * (weekly snapshot for the admin/AI report) composes it with the DB read
 * (`getBehavioralScoreHistory`). Mirrors the slope math of
 * `lib/objectives/projection.ts` but kept independent on purpose: refactoring the
 * tested fan-chart to share a helper would risk a regression for ~5 saved lines.
 *
 * POSTURE (invariant): this is a CALM process signal, never an alarmist verdict.
 * It reports the slope; the framing at the call-site stays "process > outcome"
 * (the same reason `weekly-insight-card` has no "down" branch). It feeds coaching
 * context, not a punitive member-facing message.
 */

import { DIMENSION_META, type ObjectiveDimension } from '@/lib/objectives/projection';

/** Structural mirror of `BehavioralScoreTrendPoint` (kept local so this module
 *  has zero coupling to the server-only scoring service — callers pass the
 *  service's array directly via structural typing). */
export interface MomentumHistoryPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/** Minimum non-null samples in the window before we dare report a trend
 *  (anti-noise; aligned with `MIN_HISTORY_FOR_PROJECTION`). */
export const MOMENTUM_MIN_POINTS = 6;

/** Rolling window (days) the slope is measured over — ~6 weeks of recent days. */
export const MOMENTUM_WINDOW_DAYS = 42;

/** Weekly-slope threshold (points / 7 days) below which a decline is "sustained"
 *  enough to report. Mirrors the projection trend threshold (`projection.ts:209`)
 *  so the whole app agrees on what "going down calmly" means. */
export const MOMENTUM_DECLINE_THRESHOLD = -0.5;

export interface DimensionMomentum {
  dimension: ObjectiveDimension;
  /** Short FR label (« Stabilité »), reused from DIMENSION_META. */
  label: string;
  /** Slope in points per 7 days. Negative = declining. Rounded to 0.1. */
  weeklySlope: number;
  /** Non-null samples used in the window. */
  points: number;
}

const DAY_MS = 86_400_000;

function isoToUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

/** Least-squares slope of y over x (per unit x). Returns 0 when x has no spread
 *  (all same day) — degenerate, never NaN. */
function leastSquaresSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - meanY);
  }
  return sxx === 0 ? 0 : sxy / sxx;
}

const DIMENSIONS: readonly ObjectiveDimension[] = [
  'discipline',
  'emotionalStability',
  'consistency',
  'engagement',
];

const LABEL_BY_DIM = new Map<ObjectiveDimension, string>(
  DIMENSION_META.map((m) => [m.key, m.label]),
);

/**
 * Detect dimensions whose recent trend is a SUSTAINED decline.
 *
 * For each of the 4 dimensions: take the non-null points within the last
 * `MOMENTUM_WINDOW_DAYS`, require ≥ `MOMENTUM_MIN_POINTS`, compute the weekly
 * slope, and flag it when `weeklySlope <= MOMENTUM_DECLINE_THRESHOLD`. Returns the
 * flagged declines sorted steepest-first. An empty array means "nothing drifting"
 * — the common, healthy case.
 *
 * @param history ascending-by-date trend points (as from getBehavioralScoreHistory)
 */
export function detectMomentum(history: MomentumHistoryPoint[]): DimensionMomentum[] {
  if (history.length < MOMENTUM_MIN_POINTS) return [];

  // Window anchored on the most recent point's day, not "today", so a gap before
  // an old export doesn't shift the window off the data.
  const lastDay = isoToUtcDays(history[history.length - 1]!.date);
  const windowStart = lastDay - MOMENTUM_WINDOW_DAYS;

  const out: DimensionMomentum[] = [];

  for (const dim of DIMENSIONS) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of history) {
      const value = point[dim];
      if (value === null) continue;
      const day = isoToUtcDays(point.date);
      if (day < windowStart) continue;
      xs.push(day);
      ys.push(value);
    }
    if (xs.length < MOMENTUM_MIN_POINTS) continue;

    const weeklySlope = leastSquaresSlope(xs, ys) * 7;
    if (weeklySlope <= MOMENTUM_DECLINE_THRESHOLD) {
      out.push({
        dimension: dim,
        label: LABEL_BY_DIM.get(dim) ?? dim,
        weeklySlope: Math.round(weeklySlope * 10) / 10,
        points: xs.length,
      });
    }
  }

  return out.sort((a, b) => a.weeklySlope - b.weeklySlope);
}
