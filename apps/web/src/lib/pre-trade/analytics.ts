/**
 * V2.3 ext #2 — Session HH backend (Dashboard analytics widget pre-trade) pure module.
 *
 * Carbon copy of the honesty doctrine from V2.1.3 habit-trade-correlation :
 *   - `MIN_SAMPLE_PRE_TRADE_ANALYTICS = 8` floor below which we refuse to compute
 *     anything (no fake 0%, no fake distribution).
 *   - Discriminated union with `kind: 'ok' | 'insufficient_data'` — the
 *     `insufficient_data` branch STRUCTURALLY cannot expose `distribution`
 *     or `rate` (compile-time guarantee).
 *   - Empty input ≠ below-threshold input : the `reason` field distinguishes
 *     `'no_checks'` (n=0) from `'below_threshold'` (1 ≤ n < 8) so the UI can
 *     pick a different empty-state copy ("Commence par faire 1 check pour
 *     démarrer" vs "Encore X checks avant tes premières stats").
 *
 * Pure functions :
 *   - No DB access (Prisma is the service-layer caller's concern).
 *   - No `Date.now()` (window filtering is service-layer too).
 *   - No `import 'server-only'` (this module is loadable from any runtime ;
 *     Playwright E2E can import it directly without the alias-shim trick
 *     learned in Session GG scar GG-CI).
 *
 * Posture Mark Douglas (SPEC §2) : "Cette semaine : 23 % fomo, 60 % edge"
 * = fait observé neutre, jamais punition visuelle (tone slate UI, JAMAIS
 * rouge sur fomo/revenge — Yu-kai Chou anti-Black-Hat invariant).
 *
 * Window 30j fixed V1 (pas de tabs 7d/30d/3m comme dashboard track-record).
 * Cohérent avec scoring J6 + REFLECT V1.8 + habit-trade-correlation V2.1.3.
 *
 * Out-of-scope (Sessions ultérieures) :
 *   - ❌ Correlation `pre_trade × outcome` (= Session II, différenciateur Fxmily)
 *   - ❌ Time series par semaine (= V2.x si demande membre)
 *   - ❌ Comparaison cohorte (= V2.x admin tab Session LL)
 */

/**
 * Input shape consumed by the analytics functions. The service layer extracts
 * these 3 fields from `PreTradeCheck` rows after filtering by `createdAt` 30j
 * window — the pure module does NOT see the full row to enforce data-minimality.
 */
export interface PreTradeAnalyticsInput {
  reasonToTrade: 'edge' | 'fomo' | 'revenge' | 'boredom';
  planAlignment: boolean;
  stopLossPredefined: boolean;
}

/**
 * Honesty threshold : below 8 samples, we refuse to compute any percentage
 * or distribution. Aligned with V2.1.3 `MIN_CORRELATION_PAIRS = 8` for cross-feature
 * consistency. Same reasoning : at n < 8 the noise dominates the signal,
 * surfacing a "rate" would mislead the member into seeing a pattern that does
 * not exist.
 */
export const MIN_SAMPLE_PRE_TRADE_ANALYTICS = 8;

/** Distribution counts for the 4 canonical reasons (ADR-003 enum). */
export interface ReasonCounts {
  edge: number;
  fomo: number;
  revenge: number;
  boredom: number;
}

/**
 * Result of `computeReasonDistribution`. Discriminated union — the
 * `insufficient_data` branch DOES NOT have a `distribution` field
 * (structural impossibility to fake a distribution at low n).
 */
export type ReasonDistributionResult =
  | {
      kind: 'insufficient_data';
      sampleSize: number;
      reason: 'no_checks' | 'below_threshold';
    }
  | {
      kind: 'ok';
      sampleSize: number;
      distribution: ReasonCounts;
    };

/**
 * Result of `computePlanAlignmentRate` / `computeStopLossPredefinedRate`.
 * `rate` is a float in `[0, 1]` (formatting to "%" is a UI concern).
 *
 * Rate 0.0 is a valid `ok` result (e.g. "8 checks tous false" → genuine 0 %
 * signal, distinct from "no data yet"). The `insufficient_data` branch is
 * reserved for n < 8 ; null-or-zero conflation is the anti-pattern we avoid.
 */
export type RateResult =
  | {
      kind: 'insufficient_data';
      sampleSize: number;
      reason: 'no_checks' | 'below_threshold';
    }
  | {
      kind: 'ok';
      sampleSize: number;
      /** 0 ≤ rate ≤ 1. */
      rate: number;
    };

function classifyInsufficient(sampleSize: number): {
  kind: 'insufficient_data';
  sampleSize: number;
  reason: 'no_checks' | 'below_threshold';
} {
  return {
    kind: 'insufficient_data',
    sampleSize,
    reason: sampleSize === 0 ? 'no_checks' : 'below_threshold',
  };
}

/**
 * Count how many checks fall in each of the 4 canonical reasons (edge / fomo
 * / revenge / boredom) over the input window. Returns `insufficient_data` if
 * the input has fewer than {@link MIN_SAMPLE_PRE_TRADE_ANALYTICS} checks.
 */
export function computeReasonDistribution(
  checks: readonly PreTradeAnalyticsInput[],
): ReasonDistributionResult {
  const sampleSize = checks.length;
  if (sampleSize < MIN_SAMPLE_PRE_TRADE_ANALYTICS) {
    return classifyInsufficient(sampleSize);
  }
  const distribution: ReasonCounts = { edge: 0, fomo: 0, revenge: 0, boredom: 0 };
  for (const check of checks) {
    distribution[check.reasonToTrade] += 1;
  }
  return { kind: 'ok', sampleSize, distribution };
}

/**
 * Compute the proportion of checks where `planAlignment === true` over the
 * input window. Returns `insufficient_data` below the sample-size floor.
 *
 * The member's reading : "Sur tes 23 derniers pré-trade checks, tu étais
 * aligné avec ton plan dans 78 % des cas" — fact-only, no judgment.
 */
export function computePlanAlignmentRate(checks: readonly PreTradeAnalyticsInput[]): RateResult {
  const sampleSize = checks.length;
  if (sampleSize < MIN_SAMPLE_PRE_TRADE_ANALYTICS) {
    return classifyInsufficient(sampleSize);
  }
  let aligned = 0;
  for (const check of checks) {
    if (check.planAlignment) aligned += 1;
  }
  return { kind: 'ok', sampleSize, rate: aligned / sampleSize };
}

/**
 * Compute the proportion of checks where `stopLossPredefined === true` over
 * the input window. Returns `insufficient_data` below the sample-size floor.
 *
 * The member's reading : "Tu avais ton stop-loss défini AVANT d'entrer dans
 * 60 % de tes derniers trades" — process metric, Tharp 1-2 % rule alignment
 * signal (V1.5 calibration carbone).
 */
export function computeStopLossPredefinedRate(
  checks: readonly PreTradeAnalyticsInput[],
): RateResult {
  const sampleSize = checks.length;
  if (sampleSize < MIN_SAMPLE_PRE_TRADE_ANALYTICS) {
    return classifyInsufficient(sampleSize);
  }
  let predefined = 0;
  for (const check of checks) {
    if (check.stopLossPredefined) predefined += 1;
  }
  return { kind: 'ok', sampleSize, rate: predefined / sampleSize };
}
