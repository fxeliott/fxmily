/**
 * Pure geometry for the per-trade entry / stop-loss / target schema (S11).
 *
 * The trade stores `entryPrice`, `stopLossPrice` and `plannedRR` but NOT an
 * explicit take-profit, so the target is DERIVED from the planned R:R:
 *   risk      = |entry − SL|
 *   target    = long ? entry + risk·RR : entry − risk·RR
 *
 * This is a faithful drawing of the member's OWN logged plan — descriptive, not
 * a market call (SPEC §2). Returns null when the geometry can't be drawn (no SL,
 * or a degenerate zero-risk distance), so the UI can fall back gracefully.
 */
export interface TradeRiskInput {
  entryPrice: number;
  stopLossPrice: number | null;
  plannedRR: number;
  direction: 'long' | 'short';
  exitPrice?: number | null;
  realizedR?: number | null;
}

export interface TradeRiskLevels {
  entry: number;
  stopLoss: number;
  target: number;
  direction: 'long' | 'short';
  plannedRR: number;
  /** Highest / lowest of {entry, SL, target, exit} — for axis normalisation. */
  priceMax: number;
  priceMin: number;
  exit: number | null;
  realizedR: number | null;
}

export function computeTradeRiskLevels(input: TradeRiskInput): TradeRiskLevels | null {
  const { entryPrice, stopLossPrice, plannedRR, direction } = input;
  if (stopLossPrice == null) return null;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(stopLossPrice)) return null;

  const risk = Math.abs(entryPrice - stopLossPrice);
  if (risk === 0 || !Number.isFinite(plannedRR) || plannedRR <= 0) return null;

  const reward = risk * plannedRR;
  const target = direction === 'long' ? entryPrice + reward : entryPrice - reward;

  const exit = input.exitPrice ?? null;
  const realizedR = input.realizedR ?? null;

  const points = [entryPrice, stopLossPrice, target, ...(exit != null ? [exit] : [])];
  return {
    entry: entryPrice,
    stopLoss: stopLossPrice,
    target,
    direction,
    plannedRR,
    priceMax: Math.max(...points),
    priceMin: Math.min(...points),
    exit,
    realizedR,
  };
}

/** Map a price to a 0..1 vertical position (1 = top / highest price). */
export function priceToFraction(price: number, levels: TradeRiskLevels): number {
  const span = levels.priceMax - levels.priceMin;
  if (span === 0) return 0.5;
  return (price - levels.priceMin) / span;
}
