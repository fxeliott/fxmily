import { describe, expect, it } from 'vitest';

import { computeMaxDrawdown } from './drawdown';
import type { EquityPoint } from './equity-curve';

const P = (cumR: number, ts: string, drawdownFromPeak = 0, r = 0): EquityPoint => ({
  cumR,
  ts,
  r,
  drawdownFromPeak,
});

describe('computeMaxDrawdown', () => {
  it('returns zeros on empty input', () => {
    const r = computeMaxDrawdown([]);
    expect(r.maxDrawdownR).toBe(0);
    expect(r.peakAt).toBeNull();
    expect(r.troughAt).toBeNull();
    expect(r.inDrawdown).toBe(false);
    expect(r.pointCount).toBe(0);
  });

  it('returns 0 drawdown for a strictly monotonic-up curve', () => {
    const pts = [P(1, 'a'), P(2, 'b'), P(3, 'c'), P(5, 'd')];
    const r = computeMaxDrawdown(pts);
    expect(r.maxDrawdownR).toBe(0);
    expect(r.inDrawdown).toBe(false);
    expect(r.currentDrawdownR).toBe(0);
  });

  it('detects a single dip and reports the correct peak/trough', () => {
    // 1, 3 (peak), 1 (trough, DD=2), 2
    const pts = [P(1, 'a'), P(3, 'b'), P(1, 'c'), P(2, 'd')];
    const r = computeMaxDrawdown(pts);
    expect(r.maxDrawdownR).toBe(2);
    expect(r.peakAt).toBe('b');
    expect(r.troughAt).toBe('c');
    expect(r.peakCumR).toBe(3);
    expect(r.troughCumR).toBe(1);
  });

  it('keeps the deeper drawdown when a partial recovery is followed by a new low', () => {
    // 1, 3 (peak), 2, 1, 0 (deeper trough, DD=3), 1
    const pts = [P(1, 'a'), P(3, 'b'), P(2, 'c'), P(1, 'd'), P(0, 'e'), P(1, 'f')];
    const r = computeMaxDrawdown(pts);
    expect(r.maxDrawdownR).toBe(3);
    expect(r.peakAt).toBe('b');
    expect(r.troughAt).toBe('e');
  });

  it('takes the larger of two separated drawdowns', () => {
    // 0, 5 (peak1), 2 (trough1, DD=3), 7 (peak2), 1 (trough2, DD=6), 4
    const pts = [P(0, 'a'), P(5, 'b'), P(2, 'c'), P(7, 'd'), P(1, 'e'), P(4, 'f')];
    const r = computeMaxDrawdown(pts);
    expect(r.maxDrawdownR).toBe(6);
    expect(r.peakAt).toBe('d');
    expect(r.troughAt).toBe('e');
  });

  it('reports inDrawdown=true when the last point is below the running peak', () => {
    const pts = [P(1, 'a'), P(3, 'b'), P(2, 'c')];
    const r = computeMaxDrawdown(pts);
    expect(r.inDrawdown).toBe(true);
    expect(r.currentDrawdownR).toBe(1);
  });

  it('reports inDrawdown=false when the last point is at the running peak', () => {
    const pts = [P(1, 'a'), P(3, 'b'), P(1, 'c'), P(3, 'd')];
    const r = computeMaxDrawdown(pts);
    expect(r.inDrawdown).toBe(false);
    expect(r.currentDrawdownR).toBe(0);
  });

  it('handles an entirely-negative curve (worst trade first)', () => {
    // -1, -3 (running trough never above 0), DD = 2 (peak -1 → trough -3)
    const pts = [P(-1, 'a'), P(-3, 'b'), P(-2, 'c')];
    const r = computeMaxDrawdown(pts);
    expect(r.maxDrawdownR).toBe(2);
    expect(r.peakAt).toBe('a');
    expect(r.troughAt).toBe('b');
  });

  it('handles a single point as a no-drawdown trivial curve', () => {
    const r = computeMaxDrawdown([P(2, 'a')]);
    expect(r.maxDrawdownR).toBe(0);
    expect(r.peakAt).toBe('a');
    expect(r.troughAt).toBe('a');
    expect(r.inDrawdown).toBe(false);
    expect(r.pointCount).toBe(1);
  });
});
