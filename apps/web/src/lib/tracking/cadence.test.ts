import { describe, expect, it } from 'vitest';

import { computeNextDueAt, computeOccurrenceKey, isDue } from './cadence';
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

// Sanity: the discriminated cadence union narrows exhaustively (compile guard).
const _exhaustive: TrackingCadence[] = [
  { kind: 'daily' },
  { kind: 'weekly', anchorDow: 1 },
  { kind: 'per_trade' },
  { kind: 'manual' },
];
void _exhaustive;
