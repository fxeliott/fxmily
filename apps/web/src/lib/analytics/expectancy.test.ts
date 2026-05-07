import { describe, expect, it } from 'vitest';

import { computeExpectancy, type ExpectancyTradeInput, PROFIT_FACTOR_CAP } from './expectancy';

const T = (
  outcome: 'win' | 'loss' | 'break_even' | null,
  realizedR: number | null,
  source: 'computed' | 'estimated' | null = 'computed',
  closed = true,
): ExpectancyTradeInput => ({
  outcome,
  realizedR: realizedR === null ? null : String(realizedR),
  realizedRSource: source,
  closedAt: closed ? new Date().toISOString() : null,
});

describe('computeExpectancy — empty / edge cases', () => {
  it('returns null result with reason="no_trades" on empty input', () => {
    const r = computeExpectancy([]);
    expect(r.expectancyR).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.reason).toBe('no_trades');
    expect(r.sampleSize.closedTrades).toBe(0);
  });

  it('ignores open trades (closedAt = null)', () => {
    const r = computeExpectancy([T('win', 2, 'computed', false)]);
    expect(r.reason).toBe('no_trades');
    expect(r.sampleSize.closedTrades).toBe(0);
  });

  it('returns no_computed_trades when only estimated trades are closed', () => {
    const r = computeExpectancy([T('win', 1.5, 'estimated'), T('loss', -1, 'estimated')]);
    expect(r.expectancyR).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.reason).toBe('no_computed_trades');
    // Win rate is still computable (outcome is reliable).
    expect(r.winRate).toBe(0.5);
    expect(r.lossRate).toBe(0.5);
    expect(r.sampleSize.closedTrades).toBe(2);
    expect(r.sampleSize.computedTrades).toBe(0);
    expect(r.sampleSize.estimatedTrades).toBe(2);
  });

  it('flags sufficientSample at 20 closed trades', () => {
    const trades = Array.from({ length: 19 }, () => T('win', 1));
    expect(computeExpectancy(trades).sampleSize.sufficientSample).toBe(false);
    trades.push(T('win', 1));
    expect(computeExpectancy(trades).sampleSize.sufficientSample).toBe(true);
  });
});

describe('computeExpectancy — golden values', () => {
  it('computes the textbook Van Tharp example', () => {
    // Van Tharp DPP example 1: 60% WR, avgWin = 2R, avgLoss = -1R
    // Expectancy = 0.6 * 2 + 0.4 * -1 = 0.8 R/trade
    // PF = (6 trades * 2) / (4 trades * 1) = 12/4 = 3
    const trades: ExpectancyTradeInput[] = [
      ...Array.from({ length: 6 }, () => T('win', 2)),
      ...Array.from({ length: 4 }, () => T('loss', -1)),
    ];
    const r = computeExpectancy(trades);
    expect(r.expectancyR).toBeCloseTo(0.8, 10);
    expect(r.profitFactor).toBeCloseTo(3, 10);
    expect(r.avgWinR).toBeCloseTo(2, 10);
    expect(r.avgLossR).toBeCloseTo(-1, 10);
    expect(r.payoffRatio).toBeCloseTo(2, 10);
    expect(r.winRate).toBeCloseTo(0.6, 10);
    expect(r.lossRate).toBeCloseTo(0.4, 10);
  });

  it('handles a positive-WR negative-expectancy case', () => {
    // 70% WR but small wins (0.5R) and large losses (-3R)
    // Expectancy = 0.7 * 0.5 + 0.3 * -3 = 0.35 - 0.9 = -0.55 R
    const trades: ExpectancyTradeInput[] = [
      ...Array.from({ length: 7 }, () => T('win', 0.5)),
      ...Array.from({ length: 3 }, () => T('loss', -3)),
    ];
    const r = computeExpectancy(trades);
    expect(r.expectancyR).toBeCloseTo(-0.55, 10);
    expect(r.profitFactor).toBeLessThan(1);
  });

  it('handles negative-WR positive-expectancy (good R:R)', () => {
    // 30% WR but huge wins (5R) and small losses (-1R)
    // Expectancy = 0.3 * 5 + 0.7 * -1 = 0.8 R
    const trades: ExpectancyTradeInput[] = [
      ...Array.from({ length: 3 }, () => T('win', 5)),
      ...Array.from({ length: 7 }, () => T('loss', -1)),
    ];
    const r = computeExpectancy(trades);
    expect(r.expectancyR).toBeCloseTo(0.8, 10);
    expect(r.profitFactor).toBeCloseTo((3 * 5) / (7 * 1), 10);
  });
});

describe('computeExpectancy — break_even handling', () => {
  it('counts BE in win/loss/be rates but contributes 0 to magnitude', () => {
    const trades: ExpectancyTradeInput[] = [T('win', 2), T('break_even', 0), T('loss', -1)];
    const r = computeExpectancy(trades);
    expect(r.winRate).toBeCloseTo(1 / 3, 10);
    expect(r.lossRate).toBeCloseTo(1 / 3, 10);
    expect(r.breakEvenRate).toBeCloseTo(1 / 3, 10);
    expect(r.avgWinR).toBe(2);
    expect(r.avgLossR).toBe(-1);
  });
});

describe('computeExpectancy — exclusion of estimated source', () => {
  it('keeps estimated trades in win-rate but excludes them from expectancy', () => {
    const trades: ExpectancyTradeInput[] = [
      T('win', 2, 'computed'), // contributes to magnitude
      T('win', 999, 'estimated'), // outlier — must be excluded from avgWinR
      T('loss', -1, 'computed'),
    ];
    const r = computeExpectancy(trades);
    expect(r.winRate).toBeCloseTo(2 / 3, 10);
    expect(r.avgWinR).toBe(2); // not 500.5
    expect(r.sampleSize.computedTrades).toBe(2);
    expect(r.sampleSize.estimatedTrades).toBe(1);
    expect(r.sampleSize.excludedFromExpectancy).toBe(1);
  });
});

describe('computeExpectancy — profit factor caps', () => {
  it('caps profit factor when there are no losses', () => {
    const trades = Array.from({ length: 5 }, () => T('win', 2));
    const r = computeExpectancy(trades);
    expect(r.profitFactor).toBe(PROFIT_FACTOR_CAP);
  });

  it('returns 0 profit factor when there are no wins (only losses)', () => {
    const trades = Array.from({ length: 5 }, () => T('loss', -1));
    const r = computeExpectancy(trades);
    expect(r.profitFactor).toBe(0);
    expect(r.expectancyR).toBeLessThan(0);
  });

  it('returns null payoffRatio when avgLoss = 0 (no losses)', () => {
    const trades = Array.from({ length: 5 }, () => T('win', 1));
    expect(computeExpectancy(trades).payoffRatio).toBeNull();
  });
});

describe('computeExpectancy — robustness', () => {
  it('skips trades with non-finite realizedR strings without throwing', () => {
    const trades: ExpectancyTradeInput[] = [
      T('win', 2),
      { outcome: 'loss', realizedR: 'NaN', realizedRSource: 'computed', closedAt: '2026-01-01' },
      T('loss', -1),
    ];
    const r = computeExpectancy(trades);
    expect(r.avgLossR).toBe(-1); // the NaN row was skipped
  });

  it('handles a single computed trade (n=1) without crashing', () => {
    const r = computeExpectancy([T('win', 2)]);
    expect(r.expectancyR).toBe(2);
    expect(r.winRate).toBe(1);
    expect(r.profitFactor).toBe(PROFIT_FACTOR_CAP);
  });
});
