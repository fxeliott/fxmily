import { describe, expect, it } from 'vitest';

import {
  formatLocalDate,
  isMorningReminderDue,
  isEveningReminderDue,
  isWithinQuietHours,
  localDateOf,
  localWallClockToUtc,
  nextQuietHoursEnd,
  parseLocalDate,
  shiftLocalDate,
} from './timezone';

/**
 * Local-date helpers (J5).
 *
 * The whole check-in flow anchors to the *member's* local calendar day, not
 * UTC. We rely on `Intl.DateTimeFormat` with the user's IANA timezone to
 * compute the local Y/M/D from a UTC instant — Node 22 LTS bundles full ICU,
 * so timezone names like "Europe/Paris" or "America/New_York" resolve.
 *
 * Tests use explicit ISO instants so they are stable regardless of the host
 * machine's TZ.
 */

describe('localDateOf', () => {
  it.each([
    // Europe/Paris in summer (UTC+2)
    ['2026-05-06T22:00:00Z', 'Europe/Paris', '2026-05-07'], // 00:00 next day in Paris
    ['2026-05-06T21:59:59Z', 'Europe/Paris', '2026-05-06'], // 23:59 same day
    ['2026-05-06T00:00:00Z', 'Europe/Paris', '2026-05-06'], // 02:00 same day
    // UTC reference
    ['2026-05-06T12:00:00Z', 'UTC', '2026-05-06'],
    // America/New_York in spring DST (UTC-4)
    ['2026-05-06T03:00:00Z', 'America/New_York', '2026-05-05'], // 23:00 prev day
    ['2026-05-06T04:00:00Z', 'America/New_York', '2026-05-06'], // 00:00 same day
    // Asia/Tokyo (UTC+9, no DST)
    ['2026-05-06T14:59:59Z', 'Asia/Tokyo', '2026-05-06'], // 23:59
    ['2026-05-06T15:00:00Z', 'Asia/Tokyo', '2026-05-07'], // 00:00 next day
  ] as const)('returns %s in %s as %s', (iso, tz, expected) => {
    expect(localDateOf(new Date(iso), tz)).toBe(expected);
  });

  it('falls back to UTC when timezone is invalid', () => {
    // Should not throw — bad TZ is treated as UTC.
    expect(localDateOf(new Date('2026-05-06T12:00:00Z'), 'Not/A_Real_TZ')).toBe('2026-05-06');
  });

  it('formats one-digit months and days with zero padding', () => {
    expect(localDateOf(new Date('2026-01-09T12:00:00Z'), 'UTC')).toBe('2026-01-09');
  });
});

describe('parseLocalDate', () => {
  it('parses a YYYY-MM-DD string into a UTC midnight Date', () => {
    const d = parseLocalDate('2026-05-06');
    expect(d.toISOString()).toBe('2026-05-06T00:00:00.000Z');
  });

  it('throws on malformed input', () => {
    expect(() => parseLocalDate('06/05/2026')).toThrow();
    expect(() => parseLocalDate('2026-13-01')).toThrow();
    expect(() => parseLocalDate('2026-05-32')).toThrow();
    expect(() => parseLocalDate('not-a-date')).toThrow();
  });
});

describe('shiftLocalDate', () => {
  it('moves forward by N days', () => {
    expect(shiftLocalDate('2026-05-06', 1)).toBe('2026-05-07');
    expect(shiftLocalDate('2026-05-06', 7)).toBe('2026-05-13');
  });
  it('moves backward by N days', () => {
    expect(shiftLocalDate('2026-05-06', -1)).toBe('2026-05-05');
    expect(shiftLocalDate('2026-05-06', -10)).toBe('2026-04-26');
  });
  it('handles month boundaries', () => {
    expect(shiftLocalDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('handles year boundaries', () => {
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftLocalDate('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('returns the same string when shift is 0', () => {
    expect(shiftLocalDate('2026-05-06', 0)).toBe('2026-05-06');
  });
});

describe('formatLocalDate', () => {
  it('renders a YYYY-MM-DD date as "lundi 6 mai 2026" style label in fr-FR', () => {
    const result = formatLocalDate('2026-05-06');
    // Locale-dependent — assert structurally: contains day, month name, year.
    expect(result).toMatch(/2026/);
    expect(result.toLowerCase()).toMatch(/mai/);
  });
});

describe('isMorningReminderDue', () => {
  // Default reminder window: 07:30 → 09:00 local time.
  it('returns true at 07:30 sharp in user TZ', () => {
    // 07:30 in Europe/Paris (DST May = UTC+2) = 05:30 UTC
    expect(isMorningReminderDue(new Date('2026-05-06T05:30:00Z'), 'Europe/Paris')).toBe(true);
  });

  it('returns true at 08:30 (mid-window) in user TZ', () => {
    expect(isMorningReminderDue(new Date('2026-05-06T06:30:00Z'), 'Europe/Paris')).toBe(true);
  });

  it('returns false before 07:30 in user TZ', () => {
    // 07:00 Paris = 05:00 UTC
    expect(isMorningReminderDue(new Date('2026-05-06T05:00:00Z'), 'Europe/Paris')).toBe(false);
  });

  it('returns false after 09:00 in user TZ', () => {
    // 09:01 Paris = 07:01 UTC
    expect(isMorningReminderDue(new Date('2026-05-06T07:01:00Z'), 'Europe/Paris')).toBe(false);
  });
});

describe('isEveningReminderDue', () => {
  // Default reminder window: 20:30 → 22:00 local time.
  it('returns true at 20:30 in user TZ', () => {
    // 20:30 Paris (DST May = UTC+2) = 18:30 UTC
    expect(isEveningReminderDue(new Date('2026-05-06T18:30:00Z'), 'Europe/Paris')).toBe(true);
  });

  it('returns true at 21:30 in user TZ', () => {
    expect(isEveningReminderDue(new Date('2026-05-06T19:30:00Z'), 'Europe/Paris')).toBe(true);
  });

  it('returns false before 20:30 in user TZ', () => {
    // 20:00 Paris = 18:00 UTC
    expect(isEveningReminderDue(new Date('2026-05-06T18:00:00Z'), 'Europe/Paris')).toBe(false);
  });

  it('returns false after 22:00 in user TZ', () => {
    // 22:01 Paris = 20:01 UTC
    expect(isEveningReminderDue(new Date('2026-05-06T20:01:00Z'), 'Europe/Paris')).toBe(false);
  });
});

describe('localWallClockToUtc (F2 — trade entry/exit in the member SET timezone)', () => {
  // A `datetime-local` value carries NO offset; the member's chosen IANA zone is
  // authoritative. We assert exact UTC instants so the conversion is pinned
  // DST-correct (the offset is read at the wall-clock date, not "now").
  it.each([
    // [wallClock, tz, expectedUtcIso]
    // Europe/Paris summer (CEST = UTC+2)
    ['2026-05-06T14:30', 'Europe/Paris', '2026-05-06T12:30:00.000Z'],
    // Europe/Paris winter (CET = UTC+1) — proves the offset is DST-aware
    ['2026-01-15T09:00', 'Europe/Paris', '2026-01-15T08:00:00.000Z'],
    // America/New_York summer (EDT = UTC-4)
    ['2026-05-06T08:00', 'America/New_York', '2026-05-06T12:00:00.000Z'],
    // America/New_York winter (EST = UTC-5)
    ['2026-01-15T09:00', 'America/New_York', '2026-01-15T14:00:00.000Z'],
    // Asia/Tokyo (JST = UTC+9, no DST)
    ['2026-05-06T09:00', 'Asia/Tokyo', '2026-05-06T00:00:00.000Z'],
    // Optional :ss component is honoured
    ['2026-05-06T14:30:45', 'Europe/Paris', '2026-05-06T12:30:45.000Z'],
  ] as const)('parses %s in %s → %s', (value, tz, expectedIso) => {
    const result = localWallClockToUtc(value, tz);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe(expectedIso);
  });

  it('returns null for an already-absolute ISO string (Z suffix) so a Zod coerce can handle it', () => {
    expect(localWallClockToUtc('2026-05-06T12:30:00Z', 'Europe/Paris')).toBeNull();
  });

  it('returns null for a malformed shape', () => {
    expect(localWallClockToUtc('not-a-date', 'Europe/Paris')).toBeNull();
    expect(localWallClockToUtc('2026-05-06', 'Europe/Paris')).toBeNull(); // date only, no time
  });

  it('returns null for an impossible calendar date', () => {
    expect(localWallClockToUtc('2026-02-30T10:00', 'Europe/Paris')).toBeNull();
    expect(localWallClockToUtc('2026-13-01T10:00', 'Europe/Paris')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(localWallClockToUtc('  2026-05-06T14:30  ', 'Europe/Paris')?.toISOString()).toBe(
      '2026-05-06T12:30:00.000Z',
    );
  });
});

describe('isWithinQuietHours (Tour 15 — nightly silence window [22:00, 08:00) local)', () => {
  // Explicit UTC instants → the local wall-clock is pinned by the offset comment,
  // so these assertions stay stable regardless of the host machine timezone.
  describe('Europe/Paris (May = CEST, UTC+2)', () => {
    it.each([
      // [utcIso, expectedInside, localWallClock]
      ['2026-05-06T19:59:00Z', false, '21:59 — just before silence, still delivering'],
      ['2026-05-06T20:00:00Z', true, '22:00 — silence begins (inclusive)'],
      ['2026-05-07T05:59:00Z', true, '07:59 — still silent (before 08:00)'],
      ['2026-05-07T06:00:00Z', false, '08:00 — delivery resumes (exclusive)'],
      ['2026-05-07T01:00:00Z', true, '03:00 — deep night, the 3am-buzz case'],
      ['2026-05-06T10:00:00Z', false, '12:00 — midday, wide awake'],
    ] as const)('%s → %s (%s)', (iso, expected, _label) => {
      expect(isWithinQuietHours('Europe/Paris', new Date(iso))).toBe(expected);
    });
  });

  describe('Pacific/Auckland (May = NZST, UTC+12)', () => {
    it.each([
      ['2026-05-06T09:59:00Z', false, '21:59 local — still delivering'],
      ['2026-05-06T10:00:00Z', true, '22:00 local — silence begins'],
      ['2026-05-06T19:59:00Z', true, '07:59 local — still silent'],
      ['2026-05-06T20:00:00Z', false, '08:00 local — delivery resumes'],
      ['2026-05-06T15:00:00Z', true, '03:00 local — deep night'],
    ] as const)('%s → %s (%s)', (iso, expected, _label) => {
      expect(isWithinQuietHours('Pacific/Auckland', new Date(iso))).toBe(expected);
    });
  });

  it('falls back to UTC for an invalid timezone (total, never throws)', () => {
    // 03:00 UTC — inside the window when the tz collapses to UTC.
    expect(isWithinQuietHours('Europe/Pariss', new Date('2026-05-06T03:00:00Z'))).toBe(true);
    // 12:00 UTC — outside.
    expect(isWithinQuietHours('Europe/Pariss', new Date('2026-05-06T12:00:00Z'))).toBe(false);
  });
});

describe('nextQuietHoursEnd (Tour 15 — next local 08:00 as a UTC instant)', () => {
  // The caller only defers when isWithinQuietHours is true, so the two reachable
  // branches are: local time in [00:00, 08:00) → today's 08:00; local time in
  // [22:00, 24:00) → tomorrow's 08:00.
  it('after midnight (local < 08:00) → today’s local 08:00', () => {
    // 03:00 Paris (CEST) = 01:00 UTC on 2026-05-07 → next 08:00 = 06:00 UTC same day.
    expect(nextQuietHoursEnd('Europe/Paris', new Date('2026-05-07T01:00:00Z')).toISOString()).toBe(
      '2026-05-07T06:00:00.000Z',
    );
  });

  it('before midnight (local >= 22:00) → tomorrow’s local 08:00', () => {
    // 22:30 Paris (CEST) = 20:30 UTC on 2026-05-06 → next 08:00 = 06:00 UTC on the 7th.
    expect(nextQuietHoursEnd('Europe/Paris', new Date('2026-05-06T20:30:00Z')).toISOString()).toBe(
      '2026-05-07T06:00:00.000Z',
    );
  });

  it('exactly at 22:00 local → next day 08:00 local', () => {
    // 22:00 Paris = 20:00 UTC on 2026-05-06 → 06:00 UTC on the 7th.
    expect(nextQuietHoursEnd('Europe/Paris', new Date('2026-05-06T20:00:00Z')).toISOString()).toBe(
      '2026-05-07T06:00:00.000Z',
    );
  });

  it('Pacific/Auckland after midnight → same local day 08:00 (offset-correct)', () => {
    // 03:00 Auckland (NZST UTC+12) = 15:00 UTC on 2026-05-05 → 08:00 Auckland on the
    // 6th = 20:00 UTC on the 5th.
    expect(
      nextQuietHoursEnd('Pacific/Auckland', new Date('2026-05-05T15:00:00Z')).toISOString(),
    ).toBe('2026-05-05T20:00:00.000Z');
  });

  it('is DST-correct across the European spring-forward night (08:00 always exists)', () => {
    // Europe DST 2026: clocks jump 02:00→03:00 on Sun 2026-03-29. A member awake at
    // 03:30 local that morning (= 01:30 UTC, already CEST UTC+2) → next 08:00 local
    // is 06:00 UTC the SAME day. 08:00 is never a skipped hour (the gap is 02:00–03:00).
    expect(nextQuietHoursEnd('Europe/Paris', new Date('2026-03-29T01:30:00Z')).toISOString()).toBe(
      '2026-03-29T06:00:00.000Z',
    );
  });

  it('is DST-correct across the European fall-back night', () => {
    // Europe DST ends Sun 2026-10-25, clocks 03:00→02:00. At 03:00 local that day the
    // zone is back to CET (UTC+1). Member at 03:00 local = 02:00 UTC → next 08:00
    // local = 07:00 UTC (CET offset), NOT 06:00. Proves the offset is read at 08:00.
    expect(nextQuietHoursEnd('Europe/Paris', new Date('2026-10-25T02:00:00Z')).toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
  });
});
