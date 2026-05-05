import { describe, expect, it } from 'vitest';

import { detectSession } from './sessions';

/**
 * Pure unit tests for the session-detection algorithm. We use ISO strings with
 * an explicit `Z` (UTC) offset to keep the inputs unambiguous regardless of
 * the host's local timezone.
 */
describe('detectSession', () => {
  it.each([
    ['2026-05-05T00:30:00Z', 'asia'], // very early morning UTC
    ['2026-05-05T03:00:00Z', 'asia'],
    ['2026-05-05T06:59:59Z', 'asia'],
    ['2026-05-05T07:00:00Z', 'london'], // boundary lower
    ['2026-05-05T09:00:00Z', 'london'],
    ['2026-05-05T11:59:59Z', 'london'],
    ['2026-05-05T12:00:00Z', 'overlap'], // boundary lower
    ['2026-05-05T14:00:00Z', 'overlap'],
    ['2026-05-05T15:59:59Z', 'overlap'],
    ['2026-05-05T16:00:00Z', 'newyork'], // boundary lower
    ['2026-05-05T18:30:00Z', 'newyork'],
    ['2026-05-05T20:59:59Z', 'newyork'],
    ['2026-05-05T21:00:00Z', 'asia'], // late evening = next-day Tokyo open
    ['2026-05-05T23:30:00Z', 'asia'],
  ] as const)('classifies %s as %s', (iso, expected) => {
    expect(detectSession(iso)).toBe(expected);
  });

  it('accepts a Date object', () => {
    expect(detectSession(new Date('2026-05-05T13:00:00Z'))).toBe('overlap');
  });

  it('falls back to overlap for an unparseable input', () => {
    expect(detectSession('not-a-date')).toBe('overlap');
  });

  it('honours non-UTC offsets via Date conversion', () => {
    // 09:00 in Europe/Paris (UTC+2 in May DST) = 07:00 UTC → london
    expect(detectSession('2026-05-05T09:00:00+02:00')).toBe('london');
    // 14:00 New York EDT (UTC-4) = 18:00 UTC → newyork
    expect(detectSession('2026-05-05T14:00:00-04:00')).toBe('newyork');
  });
});
