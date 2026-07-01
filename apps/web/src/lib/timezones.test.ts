import { describe, expect, it } from 'vitest';

import { localWallClockToUtc } from '@/lib/checkin/timezone';
import {
  SUPPORTED_TIMEZONES,
  buildTimezoneOptionGroups,
  formatDateTimeLocalInput,
  formatUtcOffset,
  isSupportedTimezone,
  timezoneCityLabel,
  timezoneOptionLabel,
} from '@/lib/timezones';

/**
 * F2 — IANA timezone catalogue + display helpers for the settings picker and
 * the trade entry/exit pickers. Node 22 LTS ships full ICU, so every IANA name
 * resolves and `Intl.supportedValuesOf('timeZone')` is available — the curated
 * fallback is never exercised here.
 *
 * Instants are explicit UTC so the assertions are stable regardless of the host
 * machine's timezone.
 */

// Reference instants pinned to assert DST-correct offsets.
const SUMMER = new Date('2026-05-06T12:30:00.000Z'); // EU/US in DST
const WINTER = new Date('2026-01-15T12:30:00.000Z'); // EU/US in standard time

describe('SUPPORTED_TIMEZONES', () => {
  it('is a non-empty catalogue that includes the cohort default and common regions', () => {
    expect(SUPPORTED_TIMEZONES.length).toBeGreaterThan(50); // full ICU on Node 22
    expect(SUPPORTED_TIMEZONES).toContain('Europe/Paris');
    expect(SUPPORTED_TIMEZONES).toContain('America/New_York');
    expect(SUPPORTED_TIMEZONES).toContain('UTC');
  });
});

describe('isSupportedTimezone', () => {
  it('accepts real IANA names from the catalogue', () => {
    expect(isSupportedTimezone('Europe/Paris')).toBe(true);
    expect(isSupportedTimezone('America/New_York')).toBe(true);
    expect(isSupportedTimezone('Asia/Tokyo')).toBe(true);
  });

  it('rejects garbage, look-alikes, empty and bidi-padded strings', () => {
    expect(isSupportedTimezone('')).toBe(false);
    expect(isSupportedTimezone('Mars/Olympus')).toBe(false);
    expect(isSupportedTimezone('Europe/Paris ')).toBe(false); // trailing space
    expect(isSupportedTimezone('‮Europe/Paris')).toBe(false); // RLO bidi prefix
  });
});

describe('formatUtcOffset (DST-correct at the queried instant)', () => {
  it('renders Europe/Paris as +02:00 in summer and +01:00 in winter', () => {
    expect(formatUtcOffset('Europe/Paris', SUMMER)).toBe('UTC+02:00');
    expect(formatUtcOffset('Europe/Paris', WINTER)).toBe('UTC+01:00');
  });

  it('renders America/New_York as -04:00 in summer and -05:00 in winter', () => {
    expect(formatUtcOffset('America/New_York', SUMMER)).toBe('UTC-04:00');
    expect(formatUtcOffset('America/New_York', WINTER)).toBe('UTC-05:00');
  });

  it('renders UTC as ±00:00', () => {
    expect(formatUtcOffset('UTC', SUMMER)).toBe('UTC±00:00');
  });

  it('falls back to ±00:00 for an invalid timezone (label still renders)', () => {
    expect(formatUtcOffset('Mars/Olympus', SUMMER)).toBe('UTC±00:00');
  });
});

describe('formatDateTimeLocalInput', () => {
  it('renders the wall-clock in the target timezone (no offset suffix)', () => {
    expect(formatDateTimeLocalInput(SUMMER, 'Europe/Paris')).toBe('2026-05-06T14:30');
    expect(formatDateTimeLocalInput(SUMMER, 'America/New_York')).toBe('2026-05-06T08:30');
    expect(formatDateTimeLocalInput(SUMMER, 'UTC')).toBe('2026-05-06T12:30');
  });

  it('is DST-aware (Paris winter is +01:00)', () => {
    expect(formatDateTimeLocalInput(WINTER, 'Europe/Paris')).toBe('2026-01-15T13:30');
  });

  it('falls back to the UTC wall-clock for an invalid timezone', () => {
    expect(formatDateTimeLocalInput(SUMMER, 'Mars/Olympus')).toBe('2026-05-06T12:30');
  });
});

describe('F2 round-trip: formatDateTimeLocalInput ↔ localWallClockToUtc', () => {
  // The picker pre-fills the wall-clock in the member's zone; on submit the
  // server parses that SAME wall-clock in that SAME zone. The instant must
  // survive the round-trip to the minute, in any zone and either DST phase.
  it.each([
    ['Europe/Paris', SUMMER],
    ['Europe/Paris', WINTER],
    ['America/New_York', SUMMER],
    ['America/New_York', WINTER],
    ['Asia/Tokyo', SUMMER],
    ['Pacific/Auckland', WINTER],
  ] as const)('round-trips an instant through %s', (tz, instant) => {
    const wall = formatDateTimeLocalInput(instant, tz);
    const back = localWallClockToUtc(wall, tz);
    expect(back?.toISOString()).toBe(instant.toISOString());
  });
});

describe('timezoneCityLabel', () => {
  it('humanises the place portion of an IANA name', () => {
    expect(timezoneCityLabel('America/New_York')).toBe('New York');
    expect(timezoneCityLabel('Europe/Paris')).toBe('Paris');
    expect(timezoneCityLabel('America/Argentina/Buenos_Aires')).toBe('Argentina / Buenos Aires');
    expect(timezoneCityLabel('UTC')).toBe('UTC');
  });
});

describe('timezoneOptionLabel', () => {
  it('combines the city label and the current offset', () => {
    expect(timezoneOptionLabel('Europe/Paris', SUMMER)).toBe('Paris (UTC+02:00)');
    expect(timezoneOptionLabel('America/New_York', WINTER)).toBe('New York (UTC-05:00)');
  });
});

describe('buildTimezoneOptionGroups', () => {
  it('groups by region with Europe first and every option carrying a value + label', () => {
    const groups = buildTimezoneOptionGroups(SUMMER);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]?.region).toBe('Europe');

    const europe = groups.find((g) => g.region === 'Europe');
    expect(europe?.options.some((o) => o.value === 'Europe/Paris')).toBe(true);

    for (const group of groups) {
      expect(group.options.length).toBeGreaterThan(0);
      for (const option of group.options) {
        expect(option.value).toBeTruthy();
        expect(option.label).toBeTruthy();
        expect(isSupportedTimezone(option.value)).toBe(true);
      }
    }
  });
});
