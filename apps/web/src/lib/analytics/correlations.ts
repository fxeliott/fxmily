/**
 * Correlation helpers for behavioral patterns (sleep × R, stress × outcome,
 * mood × discipline, etc.).
 *
 * We keep two flavours:
 *   - Pearson — linear correlation. Best when both variables are roughly
 *     normal and the relationship is linear. Sensitive to outliers.
 *   - Spearman — rank correlation. Robust to outliers and to monotonic
 *     non-linear relationships. Required for ordinal data (e.g. mood 1–10).
 *
 * Posture: we never display a correlation without a sample-size guard. A
 * Pearson r = 0.9 over 4 trades is meaningless. Hence `MIN_PAIRS = 8` (a
 * compromise between "show something useful early" and "don't fool the user
 * with a 3-point line"). The UI surfaces this via `<SampleSizeDisclaimer>`.
 *
 * Implementation notes:
 *   - Single-pass Welford-style means + co-moment (numerically stable for
 *     large series, though our series are small).
 *   - Returns `null` (not 0, not NaN) when correlation is undefined — the
 *     caller can render "—" or hide the panel.
 */

/** Minimum number of paired observations before we trust a correlation. */
export const MIN_CORRELATION_PAIRS = 8;

/**
 * Pearson product-moment correlation r ∈ [-1, 1].
 *
 * Returns `null` when:
 *   - the two arrays have different lengths,
 *   - either array has fewer than 2 entries,
 *   - either array has zero variance (all values equal),
 *   - any value is non-finite.
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]!) || !Number.isFinite(ys[i]!)) return null;
  }

  const n = xs.length;

  // Welford-style streaming means + co-moments — numerically stable.
  let meanX = 0;
  let meanY = 0;
  let m2X = 0; // Σ(xi − meanX)²
  let m2Y = 0;
  let cov = 0; // Σ(xi − meanX)(yi − meanY)

  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const dx = x - meanX;
    const dy = y - meanY;
    meanX += dx / (i + 1);
    meanY += dy / (i + 1);
    m2X += dx * (x - meanX);
    m2Y += dy * (y - meanY);
    cov += dx * (y - meanY);
  }

  if (m2X === 0 || m2Y === 0) return null; // zero variance

  const r = cov / Math.sqrt(m2X * m2Y);
  // Float arithmetic can drift slightly outside [-1, 1] near the boundaries.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Convert an array to ranks using the average-rank tie-breaking rule (the
 * canonical "fractional ranking" used by scipy.stats.rankdata default).
 *
 * E.g. `[1, 2, 2, 3]` → `[1, 2.5, 2.5, 4]`.
 */
export function rankWithTies(values: readonly number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    // Advance j while we're in a tied run.
    while (j + 1 < n && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const avg = (i + j + 2) / 2; // 1-based average rank
    for (let k = i; k <= j; k++) {
      ranks[indexed[k]!.i] = avg;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation ρ ∈ [-1, 1].
 *
 * Implementation: rank both arrays (with average-rank tie-breaking) then
 * apply Pearson on the ranks. This is the textbook definition, not the
 * naive 6Σd² / (n(n²-1)) shortcut which is wrong in the presence of ties.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]!) || !Number.isFinite(ys[i]!)) return null;
  }

  const rx = rankWithTies(xs);
  const ry = rankWithTies(ys);
  return pearson(rx, ry);
}

/**
 * Sample variance (n − 1 in the denominator — Bessel's correction).
 * Returns 0 for n < 2.
 */
export function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let mean = 0;
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) return Number.NaN;
    const d = v - mean;
    mean += d / (i + 1);
    m2 += d * (v - mean);
  }
  return m2 / (n - 1);
}

/** Sample standard deviation = √variance. */
export function sampleStdDev(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/**
 * Coefficient of variation = stdDev / |mean|. Returns null when:
 *   - n < 2 (variance undefined),
 *   - mean = 0 (CV undefined).
 *
 * Used by the Consistency score for trades-per-week regularity.
 */
export function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const sd = sampleStdDev(values);
  return sd / Math.abs(mean);
}

/**
 * Median, robust to outliers. Returns 0 for empty input.
 */
export function median(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
