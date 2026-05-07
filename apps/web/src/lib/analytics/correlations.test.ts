import { describe, expect, it } from 'vitest';

import {
  coefficientOfVariation,
  median,
  pearson,
  rankWithTies,
  sampleStdDev,
  sampleVariance,
  spearman,
} from './correlations';

describe('pearson', () => {
  it('returns 1 for a perfect positive linear relationship', () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 12);
  });

  it('returns -1 for a perfect negative linear relationship', () => {
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it('returns ~0 for uncorrelated data', () => {
    const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(r).not.toBeNull();
    expect(Math.abs(r!)).toBeLessThan(0.5);
  });

  it('matches scipy.stats.pearsonr golden value', () => {
    // scipy.stats.pearsonr([1,2,3,4,5,6,7,8,9,10], [2,1,4,3,6,5,8,7,10,9])
    //   → r = 0.9393939393939394
    const r = pearson([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]);
    expect(r).toBeCloseTo(0.9393939393939394, 10);
  });

  it('returns null on length mismatch', () => {
    expect(pearson([1, 2, 3], [1, 2])).toBeNull();
  });

  it('returns null on n < 2', () => {
    expect(pearson([], [])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });

  it('returns null when one variable has zero variance', () => {
    expect(pearson([1, 1, 1, 1], [2, 4, 6, 8])).toBeNull();
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
  });

  it('returns null on non-finite inputs', () => {
    expect(pearson([1, 2, Number.NaN], [4, 5, 6])).toBeNull();
    expect(pearson([1, 2, 3], [4, 5, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('clamps r to [-1, 1] under float drift', () => {
    // Very tightly correlated near 1 — make sure we don't return 1.0000000002.
    const r = pearson([0.1, 0.2, 0.3, 0.4], [1.1, 1.2, 1.3, 1.4])!;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });
});

describe('rankWithTies (average-rank rule)', () => {
  it('handles a strictly increasing sequence', () => {
    expect(rankWithTies([10, 20, 30, 40])).toEqual([1, 2, 3, 4]);
  });

  it('handles a strictly decreasing sequence', () => {
    expect(rankWithTies([40, 30, 20, 10])).toEqual([4, 3, 2, 1]);
  });

  it('averages tied ranks', () => {
    // [1, 2, 2, 3] → 1, 2.5, 2.5, 4
    expect(rankWithTies([1, 2, 2, 3])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('handles all-equal input', () => {
    expect(rankWithTies([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it('handles a triple tie at the start', () => {
    // [1, 1, 1, 4, 5] → 2, 2, 2, 4, 5
    expect(rankWithTies([1, 1, 1, 4, 5])).toEqual([2, 2, 2, 4, 5]);
  });
});

describe('spearman', () => {
  it('returns 1 for a perfect monotonic non-linear relationship', () => {
    // y = x³ — non-linear but monotonic. Pearson < 1, Spearman = 1.
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => x ** 3);
    expect(spearman(xs, ys)).toBeCloseTo(1, 12);
    expect(pearson(xs, ys)!).toBeLessThan(1);
  });

  it('returns -1 for a perfect monotonic decreasing relationship', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it('handles ties correctly (textbook formula = pearson on average ranks)', () => {
    // x=[1,2,2,3,4] → ranks [1, 2.5, 2.5, 4, 5]
    // y=[1,1,2,3,4] → ranks [1.5, 1.5, 3, 4, 5]
    // pearson on those ranks: cov=8.75, varX=9.5, varY=9.5 → r = 8.75/9.5
    const rho = spearman([1, 2, 2, 3, 4], [1, 1, 2, 3, 4]);
    expect(rho).toBeCloseTo(8.75 / 9.5, 10);
  });

  it('returns null on length mismatch and small n', () => {
    expect(spearman([1, 2], [1])).toBeNull();
    expect(spearman([1], [1])).toBeNull();
  });

  it('returns null on non-finite inputs', () => {
    expect(spearman([1, 2, Number.NaN], [4, 5, 6])).toBeNull();
  });
});

describe('sampleVariance / sampleStdDev', () => {
  it('returns 0 for n < 2', () => {
    expect(sampleVariance([])).toBe(0);
    expect(sampleVariance([42])).toBe(0);
    expect(sampleStdDev([42])).toBe(0);
  });

  it('matches the textbook formula for [2, 4, 4, 4, 5, 5, 7, 9]', () => {
    // mean = 5, sample variance = 32/7 ≈ 4.571428571
    expect(sampleVariance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(32 / 7, 10);
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it('is numerically stable on values shifted by a large constant', () => {
    // Catastrophic-cancellation trap: variance of [1e9 + ε] should equal
    // variance of [ε] thanks to Welford-style streaming.
    const a = [1, 2, 3, 4, 5];
    const b = a.map((v) => v + 1e9);
    expect(sampleVariance(b)).toBeCloseTo(sampleVariance(a), 6);
  });

  it('returns NaN when the input has non-finite values', () => {
    expect(sampleVariance([1, 2, Number.NaN])).toBeNaN();
  });
});

describe('coefficientOfVariation', () => {
  it('returns null when n < 2', () => {
    expect(coefficientOfVariation([])).toBeNull();
    expect(coefficientOfVariation([5])).toBeNull();
  });

  it('returns null when mean = 0 (CV undefined)', () => {
    expect(coefficientOfVariation([-2, 0, 2])).toBeNull();
  });

  it('returns stdDev / |mean| for a typical sample', () => {
    const xs = [10, 12, 14, 16, 18];
    const expected = sampleStdDev(xs) / Math.abs(14);
    expect(coefficientOfVariation(xs)).toBeCloseTo(expected, 12);
  });

  it('handles negative-mean sample (uses absolute value)', () => {
    const xs = [-10, -12, -14, -16, -18];
    const cv = coefficientOfVariation(xs);
    expect(cv).not.toBeNull();
    expect(cv!).toBeGreaterThan(0);
  });
});

describe('median', () => {
  it('returns 0 on empty input', () => {
    expect(median([])).toBe(0);
  });

  it('returns the middle of an odd-length array', () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
