import { describe, expect, it } from 'vitest';

import { computeNextDueAt, computeOccurrenceKey, isDue, listClosedOccurrences } from './cadence';
import type { TrackingCadence } from './types';

const TZ = 'Europe/Paris';

describe('computeOccurrenceKey', () => {
  it('daily → local YYYY-MM-DD', () => {
    // 2026-06-24 10:00 UTC → 12:00 Paris, same calendar day.
    const now = new Date('2026-06-24T10:00:00.000Z');
    expect(computeOccurrenceKey({ kind: 'daily' }, now, TZ)).toBe('2026-06-24');
  });

  it('daily → respects the Paris offset across UTC midnight', () => {
    // 2026-06-23 23:30 UTC = 2026-06-24 01:30 Paris (CEST +2) → local day is the 24th.
    const now = new Date('2026-06-23T23:30:00.000Z');
    expect(computeOccurrenceKey({ kind: 'daily' }, now, TZ)).toBe('2026-06-24');
  });

  it('weekly → ISO year-week', () => {
    // 2026-06-24 is a Wednesday in ISO week 26.
    const now = new Date('2026-06-24T10:00:00.000Z');
    expect(computeOccurrenceKey({ kind: 'weekly', anchorDow: 1 }, now, TZ)).toBe('2026-W26');
  });

  it('per_trade / manual → requires a nonce, else throws', () => {
    const now = new Date('2026-06-24T10:00:00.000Z');
    expect(computeOccurrenceKey({ kind: 'per_trade' }, now, TZ, 'trade_123')).toBe('trade_123');
    expect(() => computeOccurrenceKey({ kind: 'manual' }, now, TZ)).toThrow(/nonce/);
  });
});

describe('computeNextDueAt', () => {
  it('daily → next local midnight (tomorrow, UTC-pinned)', () => {
    const completed = new Date('2026-06-24T15:00:00.000Z');
    const next = computeNextDueAt({ kind: 'daily' }, completed, TZ);
    expect(next?.toISOString()).toBe('2026-06-25T00:00:00.000Z');
  });

  it('weekly anchorDow=1 (Monday) → next Monday strictly after completion', () => {
    // Completed Wed 2026-06-24 → next Monday is 2026-06-29.
    const completed = new Date('2026-06-24T15:00:00.000Z');
    const next = computeNextDueAt({ kind: 'weekly', anchorDow: 1 }, completed, TZ);
    expect(next?.toISOString()).toBe('2026-06-29T00:00:00.000Z');
  });

  it('weekly → completing ON the anchor day jumps a full week (never same day)', () => {
    // 2026-06-29 is a Monday (anchorDow=1). Next due must be +7d = 2026-07-06.
    const completedOnAnchor = new Date('2026-06-29T15:00:00.000Z');
    const next = computeNextDueAt({ kind: 'weekly', anchorDow: 1 }, completedOnAnchor, TZ);
    expect(next?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('per_trade / manual → null (no schedule sweep)', () => {
    const completed = new Date('2026-06-24T15:00:00.000Z');
    expect(computeNextDueAt({ kind: 'per_trade' }, completed, TZ)).toBeNull();
    expect(computeNextDueAt({ kind: 'manual' }, completed, TZ)).toBeNull();
  });
});

describe('isDue', () => {
  const now = new Date('2026-06-24T12:00:00.000Z');

  it('due when now ≥ nextDueAt and not snoozed', () => {
    expect(isDue({ nextDueAt: new Date('2026-06-24T00:00:00.000Z'), pausedUntil: null }, now)).toBe(
      true,
    );
  });

  it('not due when nextDueAt is in the future', () => {
    expect(isDue({ nextDueAt: new Date('2026-06-25T00:00:00.000Z'), pausedUntil: null }, now)).toBe(
      false,
    );
  });

  it('not due while snoozed, even if past nextDueAt', () => {
    expect(
      isDue(
        {
          nextDueAt: new Date('2026-06-20T00:00:00.000Z'),
          pausedUntil: new Date('2026-06-30T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('due again once the snooze has elapsed', () => {
    expect(
      isDue(
        {
          nextDueAt: new Date('2026-06-20T00:00:00.000Z'),
          pausedUntil: new Date('2026-06-22T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe(true);
  });
});

describe('listClosedOccurrences — the inverse of computeNextDueAt (S3 §32 skip scan)', () => {
  // Fixed clock: Thursday 2026-06-25 12:00 UTC (= 14:00 Paris), ISO week 26.
  const NOW = new Date('2026-06-25T12:00:00.000Z');
  const DAY = 86_400_000;

  it('weekly → only ISO weeks whose period closed past the grace, within lookback, newest first', () => {
    const occ = listClosedOccurrences({ kind: 'weekly', anchorDow: 1 }, NOW, TZ, {
      graceMs: 7 * DAY,
      lookbackMs: 28 * DAY,
    });
    // W26 (current) is open; W25 ended 06-22 but is still inside the 7-day grace;
    // W22 (Mon 05-25) starts before now−28d. Only W24 + W23 are closed & in range.
    expect(occ.map((o) => o.key)).toEqual(['2026-W24', '2026-W23']);
    // Keys are byte-identical to computeOccurrenceKey for a date inside the week.
    expect(computeOccurrenceKey({ kind: 'weekly', anchorDow: 1 }, occ[0]!.periodStartUtc, TZ)).toBe(
      '2026-W24',
    );
    // Period bounds are UTC-midnight of the ISO week (Mon inclusive → next Mon exclusive).
    expect(occ[0]!.periodStartUtc.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(occ[0]!.periodEndUtc.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('weekly → a shorter grace exposes the just-ended week', () => {
    const occ = listClosedOccurrences({ kind: 'weekly', anchorDow: 1 }, NOW, TZ, {
      graceMs: 1 * DAY,
      lookbackMs: 28 * DAY,
    });
    // W25 ended 2026-06-22; +1d grace = 06-23 ≤ now → now closed.
    expect(occ.map((o) => o.key)).toContain('2026-W25');
    expect(occ.map((o) => o.key)).not.toContain('2026-W26'); // current week still open
  });

  it('daily → closed local days past a 2-day grace, newest first', () => {
    const occ = listClosedOccurrences({ kind: 'daily' }, NOW, TZ, {
      graceMs: 2 * DAY,
      lookbackMs: 28 * DAY,
    });
    // 06-25..06-23 are still within (period_end + 2d); the newest closed day is 06-22.
    expect(occ[0]!.key).toBe('2026-06-22');
    expect(occ.map((o) => o.key)).not.toContain('2026-06-23');
    expect(occ[0]!.periodStartUtc.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(occ[0]!.periodEndUtc.toISOString()).toBe('2026-06-23T00:00:00.000Z');
  });

  it('lookback bounds how far back the scan ever accuses', () => {
    const tight = listClosedOccurrences({ kind: 'weekly', anchorDow: 1 }, NOW, TZ, {
      graceMs: 7 * DAY,
      lookbackMs: 10 * DAY, // oldest start = 06-15 → only W24 (start 06-08) excluded too
    });
    // now−10d = 06-15; W24 starts 06-08 < 06-15 → out of range. Nothing closed remains.
    expect(tight).toEqual([]);
  });

  it('per_trade / manual → never schedule-swept, so never a skip', () => {
    const opts = { graceMs: 0, lookbackMs: 365 * DAY };
    expect(listClosedOccurrences({ kind: 'per_trade' }, NOW, TZ, opts)).toEqual([]);
    expect(listClosedOccurrences({ kind: 'manual' }, NOW, TZ, opts)).toEqual([]);
  });
});

// Sanity: the discriminated cadence union narrows exhaustively (compile guard).
const _exhaustive: TrackingCadence[] = [
  { kind: 'daily' },
  { kind: 'weekly', anchorDow: 1 },
  { kind: 'per_trade' },
  { kind: 'manual' },
];
void _exhaustive;
