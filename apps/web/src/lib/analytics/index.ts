/**
 * Pure-function analytics helpers used by `lib/scoring/*` and the dashboard
 * widgets. No DB, no I/O — every export is a deterministic transformation
 * over arrays of plain values (or already-serialized trades / check-ins).
 *
 * Modules:
 *   - `wilson`        — confidence intervals for binomial proportions (win rates, plan-respect rates)
 *   - `correlations`  — Pearson, Spearman, variance/stdDev/CV, median
 *   - `expectancy`    — Van Tharp expectancy, profit factor, payoff ratio (excludes `estimated` source)
 *   - `streaks`       — max consecutive loss/win, theoretical max from probability rule of thumb
 *   - `equity-curve`  — chronological R-cumulative curve with drawdown-from-peak per point
 *   - `drawdown`      — max drawdown peak-to-trough over an equity curve
 */

export {
  SUFFICIENT_SAMPLE_MIN,
  winRateWithBand,
  wilsonInterval,
  Z_SCORES,
  type ConfidenceLevel,
  type WilsonInterval,
} from './wilson';

export {
  coefficientOfVariation,
  median,
  pearson,
  rankWithTies,
  sampleStdDev,
  sampleVariance,
  spearman,
  MIN_CORRELATION_PAIRS,
} from './correlations';

export {
  computeExpectancy,
  PROFIT_FACTOR_CAP,
  type ExpectancyResult,
  type ExpectancyTradeInput,
} from './expectancy';

export {
  computeExpectedMaxConsecutiveLoss,
  computeMaxConsecutiveLoss,
  computeMaxConsecutiveWin,
  type StreakTradeInput,
} from './streaks';

export {
  buildEquityCurve,
  type EquityCurveResult,
  type EquityCurveTradeInput,
  type EquityPoint,
} from './equity-curve';

export { computeMaxDrawdown, type DrawdownResult } from './drawdown';
