/**
 * Wilson score interval for a binomial proportion.
 *
 * Why Wilson and not Wald (the naive normal approximation):
 *
 * The Wald interval (p̂ ± z·√(p̂(1-p̂)/n)) is symmetric, can overshoot [0,1],
 * and collapses to a zero-width point when p̂ ∈ {0, 1}. With the small samples
 * a Fxmily member has on day-30 (often <50 closed trades), Wald lies. Wilson:
 *
 *   - Asymmetric (correctly skewed toward 0.5 for extreme proportions).
 *   - Always inside [0, 1] thanks to the (1 + z²/n) denominator shrinkage.
 *   - Stable from n ≈ 10. Empirically matches scipy's `proportion_confint`
 *     (method='wilson') to ≈1e-12 — see `wilson.test.ts`.
 *
 * The "sufficient sample" flag is OUR product policy, not a statistical one:
 * we treat n < 20 as "show the band but warn the user", and surface the policy
 * via the UI (`<SampleSizeDisclaimer>`).
 *
 * References:
 *   - Wilson, E.B. (1927). Probable inference, the law of succession, and statistical inference.
 *     J. Am. Stat. Assoc. 22, 209–212.
 *   - Newcombe, R.G. (1998). Two-sided confidence intervals for the single proportion. Stat. Med. 17.
 *   - Brown, Cai, DasGupta (2001). Interval estimation for a binomial proportion. Stat. Sci. 16(2).
 */

/** z-scores for the most common confidence levels. */
export const Z_SCORES = {
  /** 90% — z = 1.6449. Wider patterns surface, less robust. */
  c90: 1.6448536269514722,
  /** 95% — z = 1.96. Industry default (Newcombe 1998 recommendation). */
  c95: 1.959963984540054,
  /** 99% — z = 2.5758. Conservative, narrows the actionable set. */
  c99: 2.5758293035489004,
} as const;

export type ConfidenceLevel = keyof typeof Z_SCORES;

/** Result of a Wilson score interval computation. */
export interface WilsonInterval {
  /** Sample proportion p̂ = successes / total. NaN-free: 0 when total = 0. */
  point: number;
  /** Lower bound of the Wilson interval. Always in [0, point]. */
  lower: number;
  /** Upper bound of the Wilson interval. Always in [point, 1]. */
  upper: number;
  /** Number of successes (passed through for downstream display). */
  successes: number;
  /** Total trials. */
  total: number;
  /** z-score used for the interval. */
  z: number;
  /**
   * Product-level guard, not a statistical guarantee. `true` iff total ≥ 20
   * (Fxmily UI policy). Surface via `<SampleSizeDisclaimer minimum=20 />`.
   */
  sufficientSample: boolean;
}

/** Default Fxmily UI threshold below which we tag a sample as insufficient. */
export const SUFFICIENT_SAMPLE_MIN = 20;

/**
 * Compute the Wilson score interval at the given confidence level.
 *
 * @param successes number of successes (≥ 0, ≤ total)
 * @param total     number of trials (≥ 0)
 * @param confidence one of `'c90' | 'c95' | 'c99'`. Default `'c95'`.
 * @returns         `{point, lower, upper, sufficientSample, z, successes, total}`
 *
 * Edge cases:
 *   - total = 0 → all bounds are 0, sufficientSample false.
 *   - successes > total → throws TypeError (caller bug, fail loud).
 *   - successes < 0 or total < 0 → throws TypeError.
 *   - successes = 0 → lower bound is 0, upper is the one-sided "rule of three"-ish bound.
 *   - successes = total → upper is 1, lower is the symmetric one-sided bound.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  confidence: ConfidenceLevel = 'c95',
): WilsonInterval {
  if (!Number.isFinite(successes) || !Number.isFinite(total)) {
    throw new TypeError('wilsonInterval: successes and total must be finite numbers');
  }
  if (successes < 0 || total < 0) {
    throw new TypeError('wilsonInterval: successes and total must be non-negative');
  }
  if (successes > total) {
    throw new TypeError('wilsonInterval: successes cannot exceed total');
  }

  const z = Z_SCORES[confidence];

  if (total === 0) {
    return {
      point: 0,
      lower: 0,
      upper: 0,
      successes: 0,
      total: 0,
      z,
      sufficientSample: false,
    };
  }

  const n = total;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;

  // Clamp to [0, 1] — float-arithmetic edge cases at successes ∈ {0, total}.
  // Special-case the boundaries to defeat tiny epsilon drift (e.g. 0.9999…
  // instead of exactly 1 when successes = total).
  const lower = successes === 0 ? 0 : Math.max(0, center - margin);
  const upper = successes === total ? 1 : Math.min(1, center + margin);

  return {
    point: p,
    lower,
    upper,
    successes,
    total,
    z,
    sufficientSample: total >= SUFFICIENT_SAMPLE_MIN,
  };
}

/**
 * Lightweight wrapper for the common dashboard case: a win rate with its
 * 95% Wilson band.
 */
export function winRateWithBand(wins: number, total: number): WilsonInterval {
  return wilsonInterval(wins, total, 'c95');
}
