import { describe, expect, it } from 'vitest';

import { parseLocalDate } from '@/lib/checkin/timezone';

import { currentParisWeekStart, formatWeekRangeFr } from './week';

/**
 * SPEC §23.7 — the current-week anchor MUST go through the Europe/Paris
 * civil-day path, never `toISOString().slice(0,10)` on a naive instant
 * (PR#96 nocturnal flake). The night-boundary cases below FAIL if anyone
 * reverts to UTC-slice math.
 */
describe('currentParisWeekStart', () => {
  it('returns the Monday of the Paris week containing a mid-week instant', () => {
    expect(currentParisWeekStart(new Date('2026-05-13T10:00:00.000Z'))).toBe('2026-05-11');
  });

  it('returns the same day for a Monday', () => {
    expect(currentParisWeekStart(new Date('2026-05-11T10:00:00.000Z'))).toBe('2026-05-11');
  });

  it('returns the week-start Monday for a Sunday', () => {
    expect(currentParisWeekStart(new Date('2026-05-17T10:00:00.000Z'))).toBe('2026-05-11');
  });

  it('CEST night boundary — Monday 00:30 Paris (22:30Z prev day) anchors to the new week', () => {
    // Naive `toISOString().slice(0,10)` = "2026-05-10" (Sun) → WRONG week.
    expect(currentParisWeekStart(new Date('2026-05-10T22:30:00.000Z'))).toBe('2026-05-11');
  });

  it('CET (winter) night boundary — Monday 00:30 Paris (23:30Z prev day) anchors to the new week', () => {
    // 2026-01-12 is a Monday (CET=UTC+1). Naive UTC-slice = "2026-01-11"
    // (Sun) → WRONG week. This pins §23.7 in the other DST regime.
    expect(currentParisWeekStart(new Date('2026-01-11T23:30:00.000Z'))).toBe('2026-01-12');
  });

  it('always returns a Monday (UTC-midnight getUTCDay === 1)', () => {
    for (const iso of [
      '2026-05-13T10:00:00.000Z',
      '2026-01-11T23:30:00.000Z',
      '2026-12-31T12:00:00.000Z',
      '2026-03-29T01:30:00.000Z', // EU DST spring-forward day
    ]) {
      const ws = currentParisWeekStart(new Date(iso));
      expect(parseLocalDate(ws).getUTCDay()).toBe(1);
    }
  });

  it('defaults to the real clock and yields a valid Monday string', () => {
    const ws = currentParisWeekStart();
    expect(ws).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseLocalDate(ws).getUTCDay()).toBe(1);
  });
});

describe('formatWeekRangeFr', () => {
  it('formats the Monday→Sunday range in FR (UTC-pinned, no drift)', () => {
    expect(formatWeekRangeFr('2026-05-11')).toBe('11 mai → 17 mai');
  });

  it('handles a month boundary', () => {
    expect(formatWeekRangeFr('2026-06-29')).toBe('29 juin → 5 juillet');
  });
});
