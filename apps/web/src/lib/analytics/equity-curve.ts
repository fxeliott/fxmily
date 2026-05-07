/**
 * Equity curve from a sequence of closed trades, expressed in R-multiples.
 *
 * The curve is *cumulative R*: the running total of `realizedR` over time,
 * sorted chronologically by `exitedAt` (or `closedAt` fallback). Each point
 * also carries the running drawdown-from-peak so a single pass yields both
 * the line chart and the drawdown chart.
 *
 * Posture: this is the canonical industry-standard view. We mirror the
 * convention used by TradeZella, Edgewonk, FX Replay (2026 reviews) so the
 * member's intuition transfers across tools.
 *
 * Excluded from the curve:
 *   - Open trades (`closedAt = null`).
 *   - Trades with non-finite or null `realizedR`.
 *   - Trades with `realizedRSource = 'estimated'`. Same rationale as
 *     `expectancy.ts` — the placeholder values would distort the picture.
 *     We expose `estimatedExcluded` so the UI can warn the member.
 */

import type { SerializedTrade } from '@/lib/trades/service';

export type EquityCurveTradeInput = Pick<
  SerializedTrade,
  'realizedR' | 'realizedRSource' | 'outcome' | 'exitedAt' | 'closedAt'
>;

export interface EquityPoint {
  /** ISO timestamp (UTC) of the trade close — `exitedAt` when set, else `closedAt`. */
  ts: string;
  /** R for this single trade (signed). */
  r: number;
  /** Running cumulative R from the start of the curve. */
  cumR: number;
  /** Drawdown from the rolling peak, expressed in R (always ≥ 0). */
  drawdownFromPeak: number;
}

export interface EquityCurveResult {
  points: EquityPoint[];
  /** Number of estimated-source trades skipped. */
  estimatedExcluded: number;
  /** Number of trades with null/invalid realizedR skipped. */
  invalidExcluded: number;
}

function parseR(s: string | null): number | null {
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Build the equity curve from a list of (possibly mixed) trades.
 *
 * @param trades — any iterable of trades; ordering does not matter (we sort).
 */
export function buildEquityCurve(trades: readonly EquityCurveTradeInput[]): EquityCurveResult {
  let estimatedExcluded = 0;
  let invalidExcluded = 0;

  type Sortable = { ts: number; iso: string; r: number };
  const usable: Sortable[] = [];

  for (const t of trades) {
    if (t.closedAt === null) continue; // open
    if (t.realizedRSource === 'estimated') {
      estimatedExcluded++;
      continue;
    }
    const r = parseR(t.realizedR);
    if (r === null) {
      invalidExcluded++;
      continue;
    }
    const tsStr = t.exitedAt ?? t.closedAt;
    const ts = Date.parse(tsStr);
    if (!Number.isFinite(ts)) {
      invalidExcluded++;
      continue;
    }
    usable.push({ ts, iso: tsStr, r });
  }

  usable.sort((a, b) => a.ts - b.ts);

  const points: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  for (const u of usable) {
    cum += u.r;
    if (cum > peak) peak = cum;
    points.push({
      ts: u.iso,
      r: u.r,
      cumR: cum,
      drawdownFromPeak: peak - cum,
    });
  }

  return { points, estimatedExcluded, invalidExcluded };
}
