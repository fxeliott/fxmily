import type { RealizedRSource, TradeDirection, TradeOutcome } from '@/generated/prisma/enums';

/**
 * Realized-R computation (J2, SPEC §6.2).
 *
 * Reference (canonical R-multiple, Van Tharp / TraderSync / TradeZella):
 *
 *   1R       = |entry - stopLoss|
 *   P/L pts  = (exit - entry) × directionSign       // +1 long, -1 short
 *   realR    = (P/L pts) / 1R                       // signed
 *
 * Two branches:
 *   - `computed`  : we have a sane stopLoss (right side of entry, non-zero
 *                   risk). Use the canonical formula. **Reliable for analytics.**
 *   - `estimated` : missing / wrong-side / zero-risk stopLoss. Fall back to
 *                   `plannedRR` on win, -1 on loss, 0 on break_even. Tagged so
 *                   downstream aggregations can exclude estimated samples from
 *                   precision-sensitive metrics (expectancy, R-distribution).
 *
 * The result is rounded to 2 decimals (matches `Decimal(6,2)` in DB) and
 * clamped to ±99.99 to avoid integer overflow on degenerate inputs.
 */

export interface ComputeRealizedRInput {
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  /** Optional. `null`/`undefined` and invalid values trigger the estimated branch. */
  stopLossPrice: number | null | undefined;
  /** User-declared R:R target at trade open. Used as the win value in the estimated branch. */
  plannedRR: number;
  outcome: TradeOutcome;
}

export interface RealizedR {
  value: number;
  source: RealizedRSource;
}

const MAX_R = 99.99;

function isStopLossValid(direction: TradeDirection, entry: number, sl: number): boolean {
  if (!Number.isFinite(sl)) return false;
  if (sl === entry) return false;
  return direction === 'long' ? sl < entry : sl > entry;
}

function clamp(value: number, max: number): number {
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

/** Round half-away-from-zero to N decimals. Avoids the IEEE-754 "1.005 → 1.00" trap. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

export function computeRealizedR(input: ComputeRealizedRInput): RealizedR {
  const { direction, entryPrice, exitPrice, stopLossPrice, plannedRR, outcome } = input;

  if (
    stopLossPrice != null &&
    Number.isFinite(stopLossPrice) &&
    isStopLossValid(direction, entryPrice, stopLossPrice)
  ) {
    const oneR = Math.abs(entryPrice - stopLossPrice);
    const directionSign = direction === 'long' ? 1 : -1;
    const pnl = (exitPrice - entryPrice) * directionSign;
    const raw = pnl / oneR;
    return {
      value: clamp(roundTo(raw, 2), MAX_R),
      source: 'computed',
    };
  }

  // Estimated fallback
  let estimated: number;
  switch (outcome) {
    case 'win':
      estimated = plannedRR;
      break;
    case 'loss':
      estimated = -1;
      break;
    case 'break_even':
    default:
      estimated = 0;
      break;
  }
  return {
    value: clamp(roundTo(estimated, 2), MAX_R),
    source: 'estimated',
  };
}
