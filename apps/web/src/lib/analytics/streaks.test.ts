import { describe, expect, it } from 'vitest';

import {
  computeExpectedMaxConsecutiveLoss,
  computeMaxConsecutiveLoss,
  computeMaxConsecutiveWin,
  type StreakTradeInput,
} from './streaks';

const T = (
  outcome: 'win' | 'loss' | 'break_even' | null,
  exitedAt: string | null = '2026-01-01T10:00:00Z',
  closed = true,
): StreakTradeInput => ({
  outcome,
  exitedAt,
  closedAt: closed ? exitedAt : null,
});

describe('computeMaxConsecutiveLoss', () => {
  it('returns 0 for empty input', () => {
    expect(computeMaxConsecutiveLoss([])).toBe(0);
  });

  it('returns 0 when there are no losses', () => {
    expect(
      computeMaxConsecutiveLoss([
        T('win', '2026-01-01T10:00:00Z'),
        T('break_even', '2026-01-02T10:00:00Z'),
        T('win', '2026-01-03T10:00:00Z'),
      ]),
    ).toBe(0);
  });

  it('counts a single loss as streak 1', () => {
    expect(computeMaxConsecutiveLoss([T('loss', '2026-01-01T10:00:00Z')])).toBe(1);
  });

  it('finds the longest run when split by wins and BEs', () => {
    // L W L L L W L L
    expect(
      computeMaxConsecutiveLoss([
        T('loss', '2026-01-01T10:00:00Z'),
        T('win', '2026-01-02T10:00:00Z'),
        T('loss', '2026-01-03T10:00:00Z'),
        T('loss', '2026-01-04T10:00:00Z'),
        T('loss', '2026-01-05T10:00:00Z'),
        T('win', '2026-01-06T10:00:00Z'),
        T('loss', '2026-01-07T10:00:00Z'),
        T('loss', '2026-01-08T10:00:00Z'),
      ]),
    ).toBe(3);
  });

  it('treats break_even as breaking the streak (not as a loss)', () => {
    // L L BE L
    expect(
      computeMaxConsecutiveLoss([
        T('loss', '2026-01-01T10:00:00Z'),
        T('loss', '2026-01-02T10:00:00Z'),
        T('break_even', '2026-01-03T10:00:00Z'),
        T('loss', '2026-01-04T10:00:00Z'),
      ]),
    ).toBe(2);
  });

  it('sorts chronologically by exitedAt before counting (caller can pass any order)', () => {
    expect(
      computeMaxConsecutiveLoss([
        T('loss', '2026-01-03T10:00:00Z'),
        T('win', '2026-01-02T10:00:00Z'),
        T('loss', '2026-01-04T10:00:00Z'),
        T('loss', '2026-01-01T10:00:00Z'),
      ]),
    ).toBe(2); // chronological: L W L L → 2
  });

  it('skips open trades (closedAt = null) and concatenates closed neighbours', () => {
    // Open trades are filtered before iteration. Effectively L _ L → L L
    // → max consecutive = 2. Treating open trades as "neutral" (neither
    // breaks nor extends) would require holding them in the timeline; we
    // chose the simpler model — open trades simply don't exist on the
    // outcome axis. Documented behaviour.
    expect(
      computeMaxConsecutiveLoss([
        T('loss', '2026-01-01T10:00:00Z'),
        T(null, '2026-01-02T10:00:00Z', false), // open — filtered
        T('loss', '2026-01-03T10:00:00Z'),
      ]),
    ).toBe(2);
  });

  it('falls back to closedAt when exitedAt is null', () => {
    const trades: StreakTradeInput[] = [
      { outcome: 'loss', exitedAt: null, closedAt: '2026-01-01T10:00:00Z' },
      { outcome: 'loss', exitedAt: null, closedAt: '2026-01-02T10:00:00Z' },
    ];
    expect(computeMaxConsecutiveLoss(trades)).toBe(2);
  });
});

describe('computeMaxConsecutiveWin', () => {
  it('counts max consecutive wins symmetrically', () => {
    expect(
      computeMaxConsecutiveWin([
        T('win', '2026-01-01T10:00:00Z'),
        T('win', '2026-01-02T10:00:00Z'),
        T('win', '2026-01-03T10:00:00Z'),
        T('loss', '2026-01-04T10:00:00Z'),
        T('win', '2026-01-05T10:00:00Z'),
      ]),
    ).toBe(3);
  });
});

describe('computeExpectedMaxConsecutiveLoss', () => {
  it('returns 0 for non-positive n', () => {
    expect(computeExpectedMaxConsecutiveLoss(0, 0.5)).toBe(0);
    expect(computeExpectedMaxConsecutiveLoss(-10, 0.5)).toBe(0);
  });

  it('returns 0 when lossRate ≤ 0', () => {
    expect(computeExpectedMaxConsecutiveLoss(100, 0)).toBe(0);
    expect(computeExpectedMaxConsecutiveLoss(100, -0.5)).toBe(0);
  });

  it('returns n when lossRate ≥ 1 (every trade loses)', () => {
    expect(computeExpectedMaxConsecutiveLoss(100, 1)).toBe(100);
    expect(computeExpectedMaxConsecutiveLoss(50, 1.5)).toBe(50);
  });

  it('matches the Van Tharp rule of thumb (50% WR, n=100 → ~7)', () => {
    // log(100)/log(2) = 6.643... → ceil 7
    expect(computeExpectedMaxConsecutiveLoss(100, 0.5)).toBe(7);
  });

  it('matches the rule of thumb at higher loss rate (40% WR, n=100 → ~9)', () => {
    // 60% loss → log(100)/log(1/0.6) ≈ log(100)/log(1.667) ≈ 9.01
    expect(computeExpectedMaxConsecutiveLoss(100, 0.6)).toBe(10);
  });

  it('returns increasing values for larger n at fixed loss rate', () => {
    expect(computeExpectedMaxConsecutiveLoss(50, 0.5)).toBeLessThanOrEqual(
      computeExpectedMaxConsecutiveLoss(500, 0.5),
    );
  });

  it('returns increasing values for higher loss rate at fixed n', () => {
    expect(computeExpectedMaxConsecutiveLoss(100, 0.4)).toBeLessThanOrEqual(
      computeExpectedMaxConsecutiveLoss(100, 0.7),
    );
  });
});
