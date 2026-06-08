import { describe, expect, it } from 'vitest';

import { currentDaySlot, localHour, primaryCheckinSlot, type DaySlot } from './slot';

/**
 * Session 5 — pure day-slot derivation. No DB, no clock injection tricks: a
 * fixed UTC instant + a fixed IANA timezone fully determines the wall-clock
 * hour. 2026-06-08 is summer (CEST = UTC+2), so 07:00 UTC = 09:00 Paris, etc.
 */

describe('localHour', () => {
  it('reads the wall-clock hour in the given timezone (CEST = UTC+2)', () => {
    expect(localHour(new Date('2026-06-08T07:00:00Z'), 'Europe/Paris')).toBe(9);
    expect(localHour(new Date('2026-06-08T10:00:00Z'), 'Europe/Paris')).toBe(12);
    expect(localHour(new Date('2026-06-08T18:00:00Z'), 'Europe/Paris')).toBe(20);
  });

  it('renders midnight as 0, never 24', () => {
    // 22:00 UTC = 00:00 Paris next day (CEST).
    expect(localHour(new Date('2026-06-08T22:00:00Z'), 'Europe/Paris')).toBe(0);
  });

  it('falls back to UTC on an unknown timezone (defensive)', () => {
    expect(localHour(new Date('2026-06-08T15:00:00Z'), 'Not/AZone')).toBe(15);
  });
});

describe('currentDaySlot', () => {
  const cases: ReadonlyArray<[string, DaySlot]> = [
    ['2026-06-08T05:00:00Z', 'morning'], // 07:00 Paris
    ['2026-06-08T07:30:00Z', 'morning'], // 09:30 Paris
    ['2026-06-08T09:59:00Z', 'morning'], // 11:59 Paris
    ['2026-06-08T10:00:00Z', 'afternoon'], // 12:00 Paris (boundary)
    ['2026-06-08T14:00:00Z', 'afternoon'], // 16:00 Paris
    ['2026-06-08T15:59:00Z', 'afternoon'], // 17:59 Paris
    ['2026-06-08T16:00:00Z', 'evening'], // 18:00 Paris (boundary)
    ['2026-06-08T21:00:00Z', 'evening'], // 23:00 Paris
  ];
  it.each(cases)('%s → %s', (iso, expected) => {
    expect(currentDaySlot(new Date(iso), 'Europe/Paris')).toBe(expected);
  });
});

describe('primaryCheckinSlot', () => {
  it('morning + afternoon focus the MORNING check-in', () => {
    expect(primaryCheckinSlot('morning')).toBe('morning');
    expect(primaryCheckinSlot('afternoon')).toBe('morning');
  });
  it('evening focuses the EVENING check-in', () => {
    expect(primaryCheckinSlot('evening')).toBe('evening');
  });
});
