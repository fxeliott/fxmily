/**
 * V2 S2 — D1 completeness gauge (PURE math).
 *
 * Turns a per-axis "most recent capture" signal into a member-facing gauge:
 * how much of the tracking surface is currently fed, axis by axis. PURE — the
 * service supplies the signals (count/exists reads, NO P&L — §21.5 isolation);
 * this module only does the arithmetic, so it is fully unit-testable without a
 * database (CI has no Postgres).
 *
 * "Covered" = there is a capture for the axis within the freshness window
 * (default 30 days). A stale axis (last seen > window) reads as not-covered so
 * the gauge reflects CURRENT engagement, not lifetime history — the honest
 * signal the member acts on. Posture §2/§31.2: this is a calm completeness
 * read, never a streak or a score.
 */

import { getAxisLabel, TRACKING_AXES } from './axes';
import type { TrackingAxisId } from './axes';

export interface AxisCoverage {
  readonly axis: TrackingAxisId;
  readonly label: string;
  readonly covered: boolean;
  /** Most recent capture for the axis (ISO), or null if never / out of window. */
  readonly lastCapturedAt: string | null;
}

export interface TrackingCoverage {
  readonly axes: readonly AxisCoverage[];
  readonly coveredCount: number;
  readonly totalCount: number;
  /** 0..100 integer — covered / total, rounded. */
  readonly pct: number;
}

/** Default freshness window: an axis counts as covered if seen in the last 30 days. */
export const DEFAULT_COVERAGE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Compute the completeness gauge over ALL axes.
 *
 * @param lastCaptureByAxis  axis → most recent capture `Date` (or null/absent).
 * @param now                reference instant (explicit — no ambient clock).
 * @param windowDays         freshness window in days (default 30).
 */
export function computeCoverage(
  lastCaptureByAxis: ReadonlyMap<TrackingAxisId, Date | null>,
  now: Date,
  windowDays: number = DEFAULT_COVERAGE_WINDOW_DAYS,
): TrackingCoverage {
  const cutoff = now.getTime() - windowDays * DAY_MS;

  const axes: AxisCoverage[] = TRACKING_AXES.map((meta) => {
    const last = lastCaptureByAxis.get(meta.id) ?? null;
    const fresh = last !== null && last.getTime() >= cutoff;
    return {
      axis: meta.id,
      label: getAxisLabel(meta.id),
      covered: fresh,
      lastCapturedAt: fresh ? last.toISOString() : null,
    };
  });

  const coveredCount = axes.reduce((n, a) => (a.covered ? n + 1 : n), 0);
  const totalCount = axes.length;
  const pct = totalCount === 0 ? 0 : Math.round((coveredCount / totalCount) * 100);

  return { axes, coveredCount, totalCount, pct };
}
