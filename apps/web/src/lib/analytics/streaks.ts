/**
 * Loss-streak analysis.
 *
 * Two metrics matter for the UI:
 *
 *   1. `computeMaxConsecutiveLoss(trades)` — the actual longest run of
 *      consecutive losing trades, in chronological order (`exitedAt` asc).
 *      Surfaced in the dashboard so the member sees their worst-case streak.
 *
 *   2. `computeExpectedMaxConsecutiveLoss(n, lossRate)` — the *theoretical*
 *      worst streak you'd expect over n trades given a given loss rate.
 *      Formula: ceil(log(n) / log(1/lossRate)). This is the canonical
 *      "rule of thumb" used by Van Tharp and prop-firm risk education to
 *      defuse panic during normal variance: a 50% WR strategy *will* hit
 *      ~7 consecutive losses every 100 trades, by mathematical necessity.
 *
 * Mark Douglas posture: surfacing both numbers side-by-side teaches the
 * member that a 5-loss streak in a 50-trade sample is normal variance, not
 * "broken edge". Reduces tilt-driven sizing escalation.
 *
 * References:
 *   - Tharp, V. (2008). _Position Sizing for Risk Management_, ch.6.
 *   - TradeZella & Edgewonk public dashboards (2026): "Max consecutive
 *     wins/losses" surfaced alongside expected variance.
 */

import type { SerializedTrade } from '@/lib/trades/service';

export type StreakTradeInput = Pick<SerializedTrade, 'outcome' | 'exitedAt' | 'closedAt'>;

/**
 * Longest run of consecutive losing trades (outcome = 'loss'), in
 * chronological order by `exitedAt` (fallback `closedAt`).
 *
 * - `break_even` trades break the streak (a flat exit is not a loss).
 * - `win` trades break the streak.
 * - Open trades (closedAt = null) are skipped entirely.
 *
 * Returns 0 for empty / no-loss input.
 */
export function computeMaxConsecutiveLoss(trades: readonly StreakTradeInput[]): number {
  const closed = trades
    .filter((t) => t.outcome != null && t.closedAt != null)
    .map((t) => ({
      outcome: t.outcome,
      ts: Date.parse(t.exitedAt ?? t.closedAt!),
    }))
    .filter((t) => Number.isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);

  let max = 0;
  let cur = 0;
  for (const t of closed) {
    if (t.outcome === 'loss') {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

/**
 * Longest run of consecutive winning trades. Symmetric helper to the loss
 * streak — useful for surfacing "over-confidence territory" warnings.
 */
export function computeMaxConsecutiveWin(trades: readonly StreakTradeInput[]): number {
  const closed = trades
    .filter((t) => t.outcome != null && t.closedAt != null)
    .map((t) => ({
      outcome: t.outcome,
      ts: Date.parse(t.exitedAt ?? t.closedAt!),
    }))
    .filter((t) => Number.isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);

  let max = 0;
  let cur = 0;
  for (const t of closed) {
    if (t.outcome === 'win') {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

/**
 * Theoretical maximum consecutive losses expected over `n` trades given a
 * `lossRate` ∈ (0, 1). Formula: `ceil(log(n) / log(1/lossRate))`.
 *
 * Edge cases:
 *   - n ≤ 0           → 0
 *   - lossRate ≤ 0    → 0  (impossible streak)
 *   - lossRate ≥ 1    → n  (every trade loses, capped at n)
 *
 * Note: this is the "expected worst" rule of thumb (≈90th percentile in
 * practice), not a formal statistical maximum. For a precise distribution,
 * Monte Carlo simulation is the way (out of scope here).
 */
export function computeExpectedMaxConsecutiveLoss(n: number, lossRate: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(lossRate) || n <= 0 || lossRate <= 0) return 0;
  if (lossRate >= 1) return Math.max(0, Math.floor(n));
  // log(n) / log(1 / lossRate) = log(n) / -log(lossRate)
  const raw = Math.log(n) / -Math.log(lossRate);
  return Math.max(0, Math.ceil(raw));
}
