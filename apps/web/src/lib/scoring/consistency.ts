/**
 * Consistency score (SPEC §7.11).
 *
 * "Consistency" in Mark Douglas's framing is *the trader behaving the same
 * way trade after trade*. The mathematical proxies for this are well
 * established (Van Tharp _Position Sizing_, Sharpe/Calmar institutional
 * standards 2026):
 *
 *   - expectancyConsistency × 35 — positive expectancy (R/trade) clipped to
 *                                 100 at 3R+. Consistency = a positive edge
 *                                 sustained over the window.
 *   - profitFactor × 25         — gross win / gross loss, scaled so PF=1→0
 *                                 and PF=3→100.
 *   - drawdownControl × 20      — 100 − scaled(maxDD_R). 15R DD → 0.
 *   - lossStreakControl × 10    — 100 − scaled(observed/expected loss
 *                                 streak). Skipped when expected can't be
 *                                 computed (no losses yet).
 *   - sessionDispersion × 10    — 1 − Hₙ(sessions) where H is Shannon
 *                                 entropy normalized to [0, 1]. High value =
 *                                 focused on a primary session = consistent.
 *
 * Sample-size guard:
 *   - 0 closed trades → status='insufficient_data', reason='no_trades'.
 *     We do **NOT** report 0/100 — Consistency is undefined when no
 *     positions have been taken (SPEC explicit).
 *   - <20 closed trades → status='ok', sufficient=false. UI surfaces the
 *     small-sample disclaimer.
 *   - 0 computed-source trades but ≥1 estimated → status='insufficient_data',
 *     reason='no_computed_trades'. Estimated R is a placeholder, computing
 *     expectancy from it would lie.
 */

import {
  buildEquityCurve,
  computeExpectancy,
  computeExpectedMaxConsecutiveLoss,
  computeMaxConsecutiveLoss,
  computeMaxDrawdown,
  type EquityCurveTradeInput,
  type ExpectancyTradeInput,
  type StreakTradeInput,
} from '@/lib/analytics';

import { aggregateDimension, clamp, roundScore, valueSubScore } from './helpers';
import type { ConsistencyParts, ScoreResult } from './types';

export type ConsistencyTradeInput = ExpectancyTradeInput &
  EquityCurveTradeInput &
  StreakTradeInput & {
    session: 'asia' | 'london' | 'newyork' | 'overlap';
  };

export interface ConsistencyInput {
  trades: readonly ConsistencyTradeInput[];
  windowDays?: number;
}

export const CONSISTENCY_MIN_TRADES = 20;

const WEIGHT_EXPECTANCY = 35;
const WEIGHT_PROFIT_FACTOR = 25;
const WEIGHT_DRAWDOWN = 20;
const WEIGHT_LOSS_STREAK = 10;
const WEIGHT_SESSION = 10;

/**
 * R that maps to a perfect expectancyConsistency sub-score. 1R/trade → 100.
 *
 * Phase V/W calibration (2026-05-09) — was 3, beaucoup trop sévère.
 * Sources littérature trading :
 *   - Van Tharp (Trade Your Way to Financial Freedom, ch.7) : 0.5R/trade
 *     est `excellent`.
 *   - Brett Steenbarger (Daily Trading Coach) : pros discrétionnaires top
 *     decile vivent à 0.3-0.6R/trade soutenu.
 * 1R/trade est le plafond pour des fenêtres 30-trades soutenues — top 1%
 * mondial. FULL_SCALE=1 met ce plafond comme score-100 :
 *   exp=0R → score 0   (break-even, pas de edge)
 *   exp=0.3R → score 30  (bon trader)
 *   exp=0.5R → score 50  (très bon)
 *   exp=1.0R → score 100 (exceptionnel)
 *   exp>1.0R → score 100 (clampé)
 */
const EXPECTANCY_FULL_SCALE = 1;
/** PF that maps to a perfect profitFactor sub-score. PF=3 → 100. */
const PF_FULL_SCALE = 3;
/** Drawdown (R) at which control sub-score reaches 0. 15R DD → 0. */
const DD_FULL_SCALE = 15;

export function computeConsistencyScore(input: ConsistencyInput): ScoreResult<ConsistencyParts> {
  const closed = input.trades.filter((t) => t.closedAt !== null && t.outcome !== null);

  if (closed.length === 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'no_trades',
      parts: emptyParts(),
      sample: { trades: 0, sufficient: false },
    };
  }

  const exp = computeExpectancy(closed);
  if (exp.expectancyR === null) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: exp.reason ?? 'no_computed_trades',
      parts: emptyParts(),
      sample: { trades: closed.length, sufficient: false },
    };
  }

  // Expectancy sub-score: 0R → 0, 3R → 100, clamped.
  const expectancyConsistency = valueSubScore(
    clamp(exp.expectancyR / EXPECTANCY_FULL_SCALE, 0, 1),
    WEIGHT_EXPECTANCY,
    { denominator: closed.length },
  );

  // Profit-factor sub-score: PF=1 → 0, PF=3 → 100.
  const pfValue =
    exp.profitFactor === null ? 0 : clamp((exp.profitFactor - 1) / (PF_FULL_SCALE - 1), 0, 1);
  const profitFactor = valueSubScore(pfValue, WEIGHT_PROFIT_FACTOR);

  // Drawdown control: 0R → 100, 15R → 0.
  const equity = buildEquityCurve(closed);
  const dd = computeMaxDrawdown(equity.points);
  const ddValue = clamp(1 - dd.maxDrawdownR / DD_FULL_SCALE, 0, 1);
  const drawdownControl = valueSubScore(ddValue, WEIGHT_DRAWDOWN);

  // Loss streak control: scaled by expected.
  const observedLossStreak = computeMaxConsecutiveLoss(closed);
  const expectedLossStreak = computeExpectedMaxConsecutiveLoss(closed.length, exp.lossRate);
  let lossStreakControl: ConsistencyParts['lossStreakControl'] = null;
  if (expectedLossStreak > 0) {
    // streakRatio: observed / expected. 0 → perfect, 1 → at expected, ≥2 → 0.
    const streakRatio = observedLossStreak / expectedLossStreak;
    const streakValue = clamp(1 - streakRatio / 2, 0, 1);
    lossStreakControl = valueSubScore(streakValue, WEIGHT_LOSS_STREAK, {
      numerator: observedLossStreak,
      denominator: expectedLossStreak,
    });
  }

  // Session dispersion: 1 − normalizedEntropy. High = focused (consistent).
  const sessionFocus = computeSessionFocus(closed);
  const sessionDispersion = valueSubScore(sessionFocus, WEIGHT_SESSION);

  const parts: ConsistencyParts = {
    expectancyConsistency,
    profitFactor,
    drawdownControl,
    lossStreakControl,
    sessionDispersion,
  };

  const partsForAggregate = [
    expectancyConsistency,
    profitFactor,
    drawdownControl,
    lossStreakControl,
    sessionDispersion,
  ];
  const score = aggregateDimension(partsForAggregate);

  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { trades: closed.length, sufficient: closed.length >= CONSISTENCY_MIN_TRADES },
  };
}

/**
 * Compute "session focus" = 1 − normalized Shannon entropy over the four
 * sessions. A trader who always uses the London session has entropy 0 and
 * focus 1; a trader who spreads evenly across all four has entropy log2(4)
 * and focus 0.
 */
function computeSessionFocus(trades: readonly { session: string }[]): number {
  if (trades.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.session, (counts.get(t.session) ?? 0) + 1);
  const total = trades.length;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  // Max possible entropy = log2(distinctSessions). Normalize to [0, 1].
  const distinct = counts.size;
  if (distinct <= 1) return 1; // perfectly focused
  const maxEntropy = Math.log2(distinct);
  const normalized = entropy / maxEntropy;
  return clamp(1 - normalized, 0, 1);
}

function emptyParts(): ConsistencyParts {
  return {
    expectancyConsistency: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_EXPECTANCY },
    profitFactor: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_PROFIT_FACTOR },
    drawdownControl: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_DRAWDOWN },
    lossStreakControl: null,
    sessionDispersion: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_SESSION },
  };
}
