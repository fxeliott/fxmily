/**
 * Expectancy & profit factor — Van Tharp / Forex industry standards.
 *
 * Definitions (R-multiple framework):
 *   - R-multiple = trade outcome / initial risk. We persist this as
 *     `Trade.realizedR` (Decimal, serialized as string).
 *   - Win rate (WR)  = wins / total
 *   - Loss rate (LR) = losses / total
 *   - avgWinR  = mean(R | outcome=win, > 0)
 *   - avgLossR = mean(R | outcome=loss, < 0) — kept negative
 *   - Expectancy = WR * avgWinR + LR * avgLossR  (positive = mathematical edge)
 *     Equivalent to (WR * avgWinR) - (LR * |avgLossR|).
 *   - Profit factor = Σ(wins R) / |Σ(losses R)|
 *   - Payoff ratio  = avgWinR / |avgLossR|
 *
 * IMPORTANT — `realizedRSource = 'estimated'` is **excluded** from
 * expectancy / avgR / payoff because the value is a fallback (`plannedRR | -1
 * | 0`) and would inflate the magnitude. Win rate keeps estimated trades
 * (the win/loss/BE outcome itself is reliable). This matches the J2 contract
 * documented in `apps/web/CLAUDE.md`.
 *
 * Sample-size posture:
 *   - <20 closed trades → `sufficientSample = false`. UI surfaces disclaimer.
 *   - 0 closed trades → `null` result + `reason = 'no_trades'`.
 *
 * References:
 *   - Tharp, V. (2008). _Definitive Guide to Position Sizing_, ch.3.
 *   - Forex industry SOTA 2026: 100–200 trades minimum for a stable edge.
 */

import type { SerializedTrade } from '@/lib/trades/service';

import { SUFFICIENT_SAMPLE_MIN } from './wilson';

/** Cap profit factor to a finite number when there are no losses. */
export const PROFIT_FACTOR_CAP = 999;

export interface ExpectancyResult {
  /** Average R per trade (positive = edge). null when no closed trades. */
  expectancyR: number | null;
  /** Σ(wins R) / |Σ(losses R)|, capped at `PROFIT_FACTOR_CAP`. null when no closed trades. */
  profitFactor: number | null;
  /** Mean R of winning trades (computed source only). 0 if no wins. */
  avgWinR: number;
  /** Mean R of losing trades (kept negative; computed source only). 0 if no losses. */
  avgLossR: number;
  /** avgWinR / |avgLossR|. null when avgLossR = 0 (avoid Infinity). */
  payoffRatio: number | null;
  /** wins / closedTrades. 0..1. */
  winRate: number;
  /** losses / closedTrades. 0..1. */
  lossRate: number;
  /** break-evens / closedTrades. 0..1. */
  breakEvenRate: number;
  /** Counts grouped by realizedRSource. */
  sampleSize: {
    closedTrades: number;
    computedTrades: number;
    estimatedTrades: number;
    excludedFromExpectancy: number;
    sufficientSample: boolean;
  };
  /** Set when a meaningful number cannot be computed. */
  reason?: 'no_trades' | 'no_computed_trades';
}

/** Subset of SerializedTrade fields needed for expectancy. */
export type ExpectancyTradeInput = Pick<
  SerializedTrade,
  'realizedR' | 'realizedRSource' | 'outcome' | 'closedAt'
>;

/** Parse the Decimal-as-string realizedR; returns null when missing/invalid. */
function parseR(s: string | null): number | null {
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Compute expectancy & friends over a slice of (possibly closed) trades.
 *
 * Open trades (`closedAt === null`) are silently filtered out. Pass them in
 * freely — the function does not require pre-filtering by the caller.
 */
export function computeExpectancy(trades: readonly ExpectancyTradeInput[]): ExpectancyResult {
  const closed = trades.filter((t) => t.closedAt !== null && t.outcome !== null);
  const total = closed.length;

  const empty = (reason: NonNullable<ExpectancyResult['reason']>): ExpectancyResult => {
    const out: ExpectancyResult = {
      expectancyR: null,
      profitFactor: null,
      avgWinR: 0,
      avgLossR: 0,
      payoffRatio: null,
      winRate: 0,
      lossRate: 0,
      breakEvenRate: 0,
      sampleSize: {
        closedTrades: 0,
        computedTrades: 0,
        estimatedTrades: 0,
        excludedFromExpectancy: 0,
        sufficientSample: false,
      },
    };
    out.reason = reason;
    return out;
  };

  if (total === 0) return empty('no_trades');

  // Win-rate-style stats use *all* closed trades (outcome reliability is good
  // even on estimated-source trades).
  let winsAll = 0;
  let lossesAll = 0;
  let beAll = 0;
  for (const t of closed) {
    if (t.outcome === 'win') winsAll++;
    else if (t.outcome === 'loss') lossesAll++;
    else if (t.outcome === 'break_even') beAll++;
  }

  // Magnitude-sensitive stats (expectancy, avgR, profit factor) exclude
  // `estimated` source because the values are placeholders.
  const computedClosed = closed.filter((t) => t.realizedRSource === 'computed');
  const estimatedCount = closed.length - computedClosed.length;

  const sampleSize = {
    closedTrades: total,
    computedTrades: computedClosed.length,
    estimatedTrades: estimatedCount,
    excludedFromExpectancy: estimatedCount,
    sufficientSample: total >= SUFFICIENT_SAMPLE_MIN,
  };

  const winRate = winsAll / total;
  const lossRate = lossesAll / total;
  const breakEvenRate = beAll / total;

  if (computedClosed.length === 0) {
    // We have closed trades but none with reliable R — surface explicitly.
    const result: ExpectancyResult = {
      expectancyR: null,
      profitFactor: null,
      avgWinR: 0,
      avgLossR: 0,
      payoffRatio: null,
      winRate,
      lossRate,
      breakEvenRate,
      sampleSize,
    };
    result.reason = 'no_computed_trades';
    return result;
  }

  let sumWinR = 0;
  let sumLossR = 0; // kept negative (or zero)
  let nWinsR = 0;
  let nLossesR = 0;

  for (const t of computedClosed) {
    const r = parseR(t.realizedR);
    if (r === null) continue;
    if (t.outcome === 'win' && r > 0) {
      sumWinR += r;
      nWinsR++;
    } else if (t.outcome === 'loss' && r < 0) {
      sumLossR += r;
      nLossesR++;
    }
    // break_even contributes 0 to magnitude but counts in `n` below.
  }

  const avgWinR = nWinsR > 0 ? sumWinR / nWinsR : 0;
  const avgLossR = nLossesR > 0 ? sumLossR / nLossesR : 0;

  // Use the rates derived from the computed slice for expectancy magnitudes —
  // mixing rates from `closed` with magnitudes from `computed` would be
  // statistically unsound.
  const computedTotal = computedClosed.length;
  const winRateC = nWinsR / computedTotal;
  const lossRateC = nLossesR / computedTotal;
  const expectancyR = winRateC * avgWinR + lossRateC * avgLossR;

  const grossWin = sumWinR;
  const grossLoss = Math.abs(sumLossR);
  const profitFactor =
    grossLoss === 0
      ? grossWin > 0
        ? PROFIT_FACTOR_CAP
        : 0
      : Math.min(grossWin / grossLoss, PROFIT_FACTOR_CAP);

  const payoffRatio = avgLossR === 0 ? null : avgWinR / Math.abs(avgLossR);

  return {
    expectancyR,
    profitFactor,
    avgWinR,
    avgLossR,
    payoffRatio,
    winRate,
    lossRate,
    breakEvenRate,
    sampleSize,
  };
}
