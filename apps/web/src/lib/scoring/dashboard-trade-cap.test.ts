import { describe, expect, it } from 'vitest';

import { ANALYTICS_TRADE_CAP, capRecentTrades } from './dashboard-data';

/**
 * 2026-06-29 A-Z deep audit — the dashboard aggregator caps the in-memory
 * closed-trade slice so one member's pathological history can't spike heap/CPU
 * + pool-hold time on every render. `capRecentTrades` is the pure core:
 * most-recent-first input (closedAt desc, as the query orders it) → chronological
 * (asc) capped output + truncation flag. Below the cap it is a pure passthrough,
 * so the aggregator's output is byte-identical to the pre-cap behaviour.
 */

/** Build a desc slice [n, n-1, ..., 1] (most recent first, as the query yields). */
const desc = (n: number) => Array.from({ length: n }, (_, i) => n - i);

describe('capRecentTrades', () => {
  it('below the cap: keeps everything, not truncated, returned chronological (asc)', () => {
    const { trades, truncated } = capRecentTrades([3, 2, 1], 5);
    expect(truncated).toBe(false);
    expect(trades).toEqual([1, 2, 3]);
  });

  it('exactly at the cap: keeps all, not truncated', () => {
    const { trades, truncated } = capRecentTrades(desc(5), 5);
    expect(truncated).toBe(false);
    expect(trades).toEqual([1, 2, 3, 4, 5]);
  });

  it('above the cap: keeps the most-recent `cap`, truncated, drops the oldest', () => {
    const { trades, truncated } = capRecentTrades(desc(7), 5);
    expect(truncated).toBe(true);
    expect(trades).toHaveLength(5);
    // most-recent 5 (7,6,5,4,3) returned chronological asc:
    expect(trades).toEqual([3, 4, 5, 6, 7]);
    // the 2 oldest are dropped:
    expect(trades).not.toContain(1);
    expect(trades).not.toContain(2);
  });

  it('does not mutate its input', () => {
    const input = desc(3);
    const copy = [...input];
    capRecentTrades(input, 2);
    expect(input).toEqual(copy);
  });

  it('empty input', () => {
    const { trades, truncated } = capRecentTrades([], 5);
    expect(truncated).toBe(false);
    expect(trades).toEqual([]);
  });

  it('default cap is large enough to be a no-op for any realistic cohort', () => {
    expect(ANALYTICS_TRADE_CAP).toBeGreaterThanOrEqual(5000);
  });
});
