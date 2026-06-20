import { describe, expect, it } from 'vitest';

import { computeTradeRiskLevels, priceToFraction } from './risk-geometry';

describe('computeTradeRiskLevels', () => {
  it('derives the target above entry for a long (RR applied to risk)', () => {
    const l = computeTradeRiskLevels({
      entryPrice: 100,
      stopLossPrice: 90,
      plannedRR: 2,
      direction: 'long',
    });
    expect(l).not.toBeNull();
    // risk = 10, reward = 20 → target 120.
    expect(l!.target).toBe(120);
    expect(l!.priceMax).toBe(120);
    expect(l!.priceMin).toBe(90);
  });

  it('derives the target below entry for a short', () => {
    const l = computeTradeRiskLevels({
      entryPrice: 100,
      stopLossPrice: 110,
      plannedRR: 1.5,
      direction: 'short',
    });
    // risk = 10, reward = 15 → target 85.
    expect(l!.target).toBe(85);
    expect(l!.priceMin).toBe(85);
    expect(l!.priceMax).toBe(110);
  });

  it('includes the exit price in the axis span when closed', () => {
    const l = computeTradeRiskLevels({
      entryPrice: 100,
      stopLossPrice: 90,
      plannedRR: 3,
      direction: 'long',
      exitPrice: 135,
      realizedR: 3.5,
    });
    expect(l!.exit).toBe(135);
    expect(l!.realizedR).toBe(3.5);
    expect(l!.priceMax).toBe(135); // exit beyond target widens the axis
  });

  it('returns null without a stop-loss (cannot draw risk geometry)', () => {
    expect(
      computeTradeRiskLevels({
        entryPrice: 100,
        stopLossPrice: null,
        plannedRR: 2,
        direction: 'long',
      }),
    ).toBeNull();
  });

  it('returns null for a degenerate zero-risk distance', () => {
    expect(
      computeTradeRiskLevels({
        entryPrice: 100,
        stopLossPrice: 100,
        plannedRR: 2,
        direction: 'long',
      }),
    ).toBeNull();
  });

  it('maps prices to 0..1 fractions (1 = highest)', () => {
    const l = computeTradeRiskLevels({
      entryPrice: 100,
      stopLossPrice: 90,
      plannedRR: 2,
      direction: 'long',
    })!;
    expect(priceToFraction(120, l)).toBe(1); // top
    expect(priceToFraction(90, l)).toBe(0); // bottom
    expect(priceToFraction(105, l)).toBeCloseTo(0.5, 5);
  });
});
