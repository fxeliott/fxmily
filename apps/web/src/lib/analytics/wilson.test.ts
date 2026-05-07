import { describe, expect, it } from 'vitest';

import { SUFFICIENT_SAMPLE_MIN, winRateWithBand, wilsonInterval, Z_SCORES } from './wilson';

const APPROX = 1e-9;

describe('wilsonInterval', () => {
  it('returns an all-zero, insufficient interval when total = 0', () => {
    const r = wilsonInterval(0, 0);
    expect(r.point).toBe(0);
    expect(r.lower).toBe(0);
    expect(r.upper).toBe(0);
    expect(r.successes).toBe(0);
    expect(r.total).toBe(0);
    expect(r.sufficientSample).toBe(false);
  });

  it('throws when successes > total (caller bug, fail loud)', () => {
    expect(() => wilsonInterval(11, 10)).toThrow(TypeError);
  });

  it('throws on negative inputs', () => {
    expect(() => wilsonInterval(-1, 10)).toThrow(TypeError);
    expect(() => wilsonInterval(5, -10)).toThrow(TypeError);
  });

  it('throws on non-finite inputs', () => {
    expect(() => wilsonInterval(Number.NaN, 10)).toThrow(TypeError);
    expect(() => wilsonInterval(5, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('matches the Newcombe (1998) golden value for 81/263 at 95%', () => {
    // Newcombe Table I, row 1: x=81, n=263, 95% Wilson → [0.2553, 0.3662].
    const r = wilsonInterval(81, 263, 'c95');
    expect(r.point).toBeCloseTo(81 / 263, 10);
    expect(r.lower).toBeCloseTo(0.2553, 3);
    expect(r.upper).toBeCloseTo(0.3662, 3);
  });

  it('matches scipy proportion_confint (wilson) at 12/20 95%', () => {
    // scipy.stats.proportion_confint(12, 20, alpha=0.05, method='wilson')
    //   → (0.38658747528520146, 0.7805029439492418)
    const r = wilsonInterval(12, 20, 'c95');
    expect(r.lower).toBeCloseTo(0.38658747528520146, APPROX);
    expect(r.upper).toBeCloseTo(0.7805029439492418, APPROX);
  });

  it('clamps the lower bound to 0 when successes = 0', () => {
    const r = wilsonInterval(0, 30, 'c95');
    expect(r.point).toBe(0);
    expect(r.lower).toBe(0);
    expect(r.upper).toBeGreaterThan(0); // one-sided upper, not zero-width
    expect(r.upper).toBeLessThan(1);
  });

  it('clamps the upper bound to 1 when successes = total', () => {
    const r = wilsonInterval(30, 30, 'c95');
    expect(r.point).toBe(1);
    expect(r.lower).toBeGreaterThan(0); // one-sided lower
    expect(r.lower).toBeLessThan(1);
    expect(r.upper).toBe(1);
  });

  it('produces an asymmetric interval near the boundaries', () => {
    // Near p = 0.95, Wilson is asymmetric (skewed toward 0.5) — Wald would lie.
    const r = wilsonInterval(95, 100, 'c95');
    const distLow = r.point - r.lower;
    const distHigh = r.upper - r.point;
    expect(distLow).toBeGreaterThan(distHigh); // skewed downward
  });

  it('keeps both bounds within [0, 1]', () => {
    for (let n = 1; n <= 50; n++) {
      for (let s = 0; s <= n; s++) {
        const r = wilsonInterval(s, n);
        expect(r.lower).toBeGreaterThanOrEqual(0);
        expect(r.upper).toBeLessThanOrEqual(1);
        expect(r.lower).toBeLessThanOrEqual(r.upper);
      }
    }
  });

  it('flags sufficientSample at the 20-trial threshold (Fxmily UI policy)', () => {
    expect(wilsonInterval(10, 19).sufficientSample).toBe(false);
    expect(wilsonInterval(10, SUFFICIENT_SAMPLE_MIN).sufficientSample).toBe(true);
    expect(wilsonInterval(60, 100).sufficientSample).toBe(true);
  });

  it('honors the 90% z-score', () => {
    // 90% interval is narrower than 95% by definition.
    const r95 = wilsonInterval(60, 100, 'c95');
    const r90 = wilsonInterval(60, 100, 'c90');
    const w95 = r95.upper - r95.lower;
    const w90 = r90.upper - r90.lower;
    expect(w90).toBeLessThan(w95);
  });

  it('honors the 99% z-score (wider than 95%)', () => {
    const r95 = wilsonInterval(60, 100, 'c95');
    const r99 = wilsonInterval(60, 100, 'c99');
    expect(r99.upper - r99.lower).toBeGreaterThan(r95.upper - r95.lower);
  });

  it('exposes the requested z in the returned interval', () => {
    expect(wilsonInterval(1, 10, 'c95').z).toBe(Z_SCORES.c95);
    expect(wilsonInterval(1, 10, 'c90').z).toBe(Z_SCORES.c90);
    expect(wilsonInterval(1, 10, 'c99').z).toBe(Z_SCORES.c99);
  });
});

describe('winRateWithBand', () => {
  it('is a 95% wrapper of wilsonInterval', () => {
    const a = winRateWithBand(12, 20);
    const b = wilsonInterval(12, 20, 'c95');
    expect(a).toEqual(b);
  });
});
