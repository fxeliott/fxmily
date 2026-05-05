import { describe, expect, it } from 'vitest';

import { computeRealizedR } from './calculations';

/**
 * Reference: TraderSync, TradeZella, JournalPlus, Van Tharp Institute.
 * Canonical formula:
 *   1R       = |entry - stopLoss|
 *   P/L pts  = (exit - entry) × directionSign
 *   realR    = (P/L pts) / 1R          (signed)
 *
 * Tests use number inputs and 2-decimal rounding tolerance because that's
 * what the wizard ultimately persists to Prisma's `Decimal(6,2)` column.
 */

describe('computeRealizedR — computed branch (stopLoss provided)', () => {
  it('long winner at full target = +plannedRR', () => {
    // Entry 1.10000, SL 1.09500 (-50 pips), TP 1.11000 (+100 pips) → 2R win
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.11,
      stopLossPrice: 1.095,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(2, 2);
  });

  it('long full-stop loss = -1R exactly', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.095,
      stopLossPrice: 1.095,
      plannedRR: 2,
      outcome: 'loss',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(-1, 2);
  });

  it('long partial winner 1.5R', () => {
    // Risk 50 pips, exit +75 pips
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.10075,
      stopLossPrice: 1.0995,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(1.5, 2);
  });

  it('short winner', () => {
    // Short EURUSD entry 1.10, SL 1.105, exit 1.09 → win 2R
    const r = computeRealizedR({
      direction: 'short',
      entryPrice: 1.1,
      exitPrice: 1.09,
      stopLossPrice: 1.105,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(2, 2);
  });

  it('short loser', () => {
    // Short, exit went up = loss
    const r = computeRealizedR({
      direction: 'short',
      entryPrice: 1.1,
      exitPrice: 1.105,
      stopLossPrice: 1.105,
      plannedRR: 2,
      outcome: 'loss',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(-1, 2);
  });

  it('break_even when exit ≈ entry', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.1,
      stopLossPrice: 1.095,
      plannedRR: 2,
      outcome: 'break_even',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(0, 2);
  });

  it('rounds to 2 decimals', () => {
    // Risk 50 pips, exit +37 pips → 0.74R
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.10037,
      stopLossPrice: 1.0995,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.value).toBeCloseTo(0.74, 2);
    // Result must be exactly two-decimal (no trailing fp noise)
    expect(Number(r.value.toFixed(2))).toBe(r.value);
  });

  it('handles JPY-style precision (3 decimals on price)', () => {
    // USDJPY entry 152.000, SL 151.500 (-50 pips), exit 152.500 (+50 pips) = 1R
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 152.0,
      exitPrice: 152.5,
      stopLossPrice: 151.5,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBeCloseTo(1, 2);
  });

  it('handles index-style large prices (US30)', () => {
    // Entry 35000, SL 34950 (-50pts), exit 35100 (+100pts) = 2R
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 35000,
      exitPrice: 35100,
      stopLossPrice: 34950,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.value).toBeCloseTo(2, 2);
  });
});

describe('computeRealizedR — estimated fallback (no stopLoss)', () => {
  it('win → +plannedRR', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.12,
      stopLossPrice: null,
      plannedRR: 2.5,
      outcome: 'win',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(2.5, 2);
  });

  it('loss → -1', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.09,
      stopLossPrice: null,
      plannedRR: 2.5,
      outcome: 'loss',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(-1, 2);
  });

  it('break_even → 0', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.1,
      stopLossPrice: null,
      plannedRR: 2.5,
      outcome: 'break_even',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(0, 2);
  });

  it('falls back to estimated when stopLoss equals entry (zero risk)', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.12,
      stopLossPrice: 1.1,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(2, 2);
  });

  it('falls back to estimated when stopLoss is on the wrong side (long with SL > entry)', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.12,
      stopLossPrice: 1.105, // invalid for long
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(2, 2);
  });

  it('falls back to estimated when stopLoss is on the wrong side (short with SL < entry)', () => {
    const r = computeRealizedR({
      direction: 'short',
      entryPrice: 1.1,
      exitPrice: 1.08,
      stopLossPrice: 1.095, // invalid for short
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(2, 2);
  });
});

describe('computeRealizedR — clamping', () => {
  it('clamps the result to ±99.99 to fit DECIMAL(6,2)', () => {
    // Tiny risk (1 pip), huge reward (1000 pips) → 1000R, must clamp to 99.99
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.2,
      stopLossPrice: 1.0999,
      plannedRR: 2,
      outcome: 'win',
    });
    expect(r.source).toBe('computed');
    expect(r.value).toBe(99.99);
  });

  it('clamps negative outliers symmetrically', () => {
    const r = computeRealizedR({
      direction: 'long',
      entryPrice: 1.1,
      exitPrice: 1.0,
      stopLossPrice: 1.0999,
      plannedRR: 2,
      outcome: 'loss',
    });
    expect(r.value).toBe(-99.99);
  });
});
