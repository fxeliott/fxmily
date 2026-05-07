/**
 * Internal helpers shared by the four scoring dimensions. Pure functions, no
 * I/O. Kept here (rather than inside each dimension file) so the formulas
 * stay readable.
 */

/** Clamp v to [lo, hi]. NaN-safe via the early return. */
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Build a sub-score from a numerator / denominator pair plus a weight.
 * - Returns rate=0, points=0 when denominator=0 (safe default).
 * - Caller is responsible for "skip this sub-score" semantics (renormalize).
 */
export function rateSubScore(
  numerator: number,
  denominator: number,
  weight: number,
): {
  rate: number;
  pointsAwarded: number;
  pointsMax: number;
  numerator: number;
  denominator: number;
} {
  if (denominator <= 0) {
    return { rate: 0, pointsAwarded: 0, pointsMax: weight, numerator, denominator };
  }
  const rate = clamp(numerator / denominator, 0, 1);
  return {
    rate,
    pointsAwarded: rate * weight,
    pointsMax: weight,
    numerator,
    denominator,
  };
}

/**
 * Build a sub-score from a raw normalized value already in [0, 1].
 * Exists to keep typing consistent across "rate from N/D" and "rate from
 * direct value" sub-scores.
 *
 * `numerator`/`denominator` are optional metadata. To "skip" one, pass
 * `null` (rather than `undefined`) — the function will omit the key
 * entirely from the returned object, which keeps `exactOptionalPropertyTypes`
 * happy.
 */
export function valueSubScore(
  value: number,
  weight: number,
  meta: { numerator?: number | null; denominator?: number | null } = {},
): {
  rate: number;
  pointsAwarded: number;
  pointsMax: number;
  numerator?: number;
  denominator?: number;
} {
  const rate = clamp(value, 0, 1);
  const out: {
    rate: number;
    pointsAwarded: number;
    pointsMax: number;
    numerator?: number;
    denominator?: number;
  } = {
    rate,
    pointsAwarded: rate * weight,
    pointsMax: weight,
  };
  if (meta.numerator !== undefined && meta.numerator !== null) out.numerator = meta.numerator;
  if (meta.denominator !== undefined && meta.denominator !== null)
    out.denominator = meta.denominator;
  return out;
}

/**
 * Round a 0–100 score to the nearest integer, biased to round half-up.
 * Returns null if the input is null/NaN.
 */
export function roundScore(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Sum the points awarded over a list of sub-scores (some may be null when a
 * sub-score is "not applicable" — e.g. all trades flag hedge as N/A).
 *
 * Renormalization: when one or more sub-scores are null, we redistribute
 * their weight onto the survivors so the dimension total still ranges 0–100.
 */
export function aggregateDimension(
  parts: Array<{ pointsAwarded: number; pointsMax: number } | null>,
): number {
  let totalAwarded = 0;
  let totalMaxActive = 0;
  for (const p of parts) {
    if (p === null) continue;
    totalAwarded += p.pointsAwarded;
    totalMaxActive += p.pointsMax;
  }
  if (totalMaxActive <= 0) return 0;
  return (totalAwarded / totalMaxActive) * 100;
}
