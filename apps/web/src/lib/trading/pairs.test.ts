import { describe, expect, it } from 'vitest';

import { TRADING_PAIRS, assetClassOf, isTradingPair, pricePrecisionOf } from './pairs';

describe('TRADING_PAIRS', () => {
  it('exposes exactly 12 symbols', () => {
    expect(TRADING_PAIRS).toHaveLength(12);
  });

  it('matches the SPEC §7.3 allowlist validated by Eliot 2026-05-05', () => {
    expect(TRADING_PAIRS).toEqual([
      'EURUSD',
      'GBPUSD',
      'USDJPY',
      'USDCHF',
      'AUDUSD',
      'USDCAD',
      'NZDUSD',
      'XAUUSD',
      'XAGUSD',
      'US30',
      'NAS100',
      'SPX500',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(TRADING_PAIRS).size).toBe(TRADING_PAIRS.length);
  });
});

describe('isTradingPair', () => {
  it.each(TRADING_PAIRS)('accepts %s', (pair) => {
    expect(isTradingPair(pair)).toBe(true);
  });

  it.each(['eurusd', 'BTCUSD', 'EUR-USD', '', 'USDJPY '])('rejects %s', (input) => {
    expect(isTradingPair(input)).toBe(false);
  });
});

describe('assetClassOf', () => {
  it.each([
    ['EURUSD', 'forex'],
    ['USDJPY', 'forex'],
    ['XAUUSD', 'metal'],
    ['XAGUSD', 'metal'],
    ['US30', 'index'],
    ['NAS100', 'index'],
    ['SPX500', 'index'],
  ] as const)('classifies %s as %s', (pair, expected) => {
    expect(assetClassOf(pair)).toBe(expected);
  });
});

describe('pricePrecisionOf', () => {
  it('uses 5 decimals for forex majors', () => {
    expect(pricePrecisionOf('EURUSD')).toBe(5);
    expect(pricePrecisionOf('GBPUSD')).toBe(5);
  });

  it('uses 3 decimals for JPY pairs', () => {
    expect(pricePrecisionOf('USDJPY')).toBe(3);
  });

  it('uses 2 decimals for metals and indices', () => {
    expect(pricePrecisionOf('XAUUSD')).toBe(2);
    expect(pricePrecisionOf('US30')).toBe(2);
    expect(pricePrecisionOf('NAS100')).toBe(2);
  });
});
