/**
 * Maximum drawdown — the largest peak-to-trough decline along an equity
 * curve.
 *
 * Industry definition (TradeZella, Edgewonk, FX Replay 2026):
 *   maxDD = max over all (peak, trough) pairs of (peak - trough), where
 *   peak precedes trough in time.
 *
 * Equivalent single-pass algorithm: maintain the running peak, track the
 * largest deficit between the peak and the current point.
 *
 * Important distinction (often confused by non-traders):
 *   - **Loss streak** = consecutive losing trades (see `streaks.ts`).
 *   - **Max drawdown** = peak-to-trough decline of the cumulative R curve.
 *
 * Two trades can produce the same loss streak with very different drawdowns,
 * because partial recoveries between losses do NOT reset the drawdown
 * measurement until a new peak is reached. This is why we track both.
 *
 * Personal-account benchmarks (industry SOTA 2026):
 *   - <15% DD = comfortable
 *   - 15-25% = tolerable, requires conviction
 *   - 25-40% = difficult psychologically
 *   - >40% = dangerous
 *
 * In R-multiple land, the ~$ thresholds map roughly to:
 *   - <15R DD = healthy (assumes 1% risk → 15% account DD)
 *   - >25R DD = warning territory
 */

import type { EquityPoint } from './equity-curve';

export interface DrawdownResult {
  /** Largest peak-to-trough decline, in R. Always ≥ 0. */
  maxDrawdownR: number;
  /** ISO timestamp of the peak that preceded the worst trough. null if curve empty. */
  peakAt: string | null;
  /** ISO timestamp of the deepest trough. null if curve empty. */
  troughAt: string | null;
  /** Cumulative R at the peak. */
  peakCumR: number;
  /** Cumulative R at the trough. */
  troughCumR: number;
  /** Whether the curve is currently in a drawdown (last point < running peak). */
  inDrawdown: boolean;
  /** Current drawdown depth at the last point (R). 0 when at a peak. */
  currentDrawdownR: number;
  /** Total number of points scanned. */
  pointCount: number;
}

/**
 * Compute the maximum drawdown over an equity curve produced by
 * `buildEquityCurve`. Single pass, O(n).
 */
export function computeMaxDrawdown(points: readonly EquityPoint[]): DrawdownResult {
  if (points.length === 0) {
    return {
      maxDrawdownR: 0,
      peakAt: null,
      troughAt: null,
      peakCumR: 0,
      troughCumR: 0,
      inDrawdown: false,
      currentDrawdownR: 0,
      pointCount: 0,
    };
  }

  let peakCum = points[0]!.cumR;
  let peakIso = points[0]!.ts;

  // Tracks the peak that *preceded* the current worst trough. We stash the
  // current running peak alongside, only promoting it when a deeper drawdown
  // is found.
  let runningPeakIso = points[0]!.ts;
  let runningPeakCum = points[0]!.cumR;

  let maxDD = 0;
  let troughIso = points[0]!.ts;
  let troughCum = points[0]!.cumR;

  for (const p of points) {
    if (p.cumR > runningPeakCum) {
      runningPeakCum = p.cumR;
      runningPeakIso = p.ts;
    }
    const dd = runningPeakCum - p.cumR;
    if (dd > maxDD) {
      maxDD = dd;
      peakCum = runningPeakCum;
      peakIso = runningPeakIso;
      troughCum = p.cumR;
      troughIso = p.ts;
    }
  }

  const last = points[points.length - 1]!;
  const currentDrawdownR = runningPeakCum - last.cumR;

  return {
    maxDrawdownR: maxDD,
    peakAt: peakIso,
    troughAt: troughIso,
    peakCumR: peakCum,
    troughCumR: troughCum,
    inDrawdown: currentDrawdownR > 0,
    currentDrawdownR,
    pointCount: points.length,
  };
}
