import { describe, expect, it } from 'vitest';

import { checkinCta } from './checkin-cta';

/**
 * Dynamic check-in CTA slot (SCOPE 4).
 *
 * Mirrors the rule used by `app/checkin/page.tsx` (`currentHourIn`): the local
 * hour in the member's timezone via `Intl.DateTimeFormat('en-GB', { hour:
 * '2-digit', hour12: false })`, then `< 14 => morning, else evening`. The
 * timezone flows through `safeTimeZone()` so a non-IANA legacy value falls back
 * to Europe/Paris instead of throwing.
 *
 * Tests pin explicit ISO instants so they stay stable regardless of the host
 * machine's own timezone.
 */

describe('checkinCta', () => {
  it('21:00 Europe/Paris in summer (CEST, UTC+2) => evening', () => {
    // 19:00Z + 2h = 21:00 local Paris (été).
    const result = checkinCta(new Date('2026-07-23T19:00:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('evening');
    expect(result.href).toBe('/checkin/evening');
    expect(result.label).toBe('Faire mon check-in du soir');
  });

  it('21:00 Europe/Paris in winter (CET, UTC+1) => evening — DST is honoured per-instant', () => {
    // 20:00Z + 1h = 21:00 local Paris (hiver). Proves the offset is read for the
    // queried instant, not assumed +2 year-round.
    const result = checkinCta(new Date('2026-01-15T20:00:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('evening');
    expect(result.href).toBe('/checkin/evening');
    expect(result.label).toBe('Faire mon check-in du soir');
  });

  it('08:00 Europe/Paris => morning', () => {
    // 06:00Z + 2h = 08:00 local Paris (été).
    const result = checkinCta(new Date('2026-07-23T06:00:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('morning');
    expect(result.href).toBe('/checkin/morning');
    expect(result.label).toBe('Faire mon check-in du matin');
  });

  it('boundary 13:59 local => morning', () => {
    // 11:59Z + 2h = 13:59 local Paris (été).
    const result = checkinCta(new Date('2026-07-23T11:59:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('morning');
    expect(result.href).toBe('/checkin/morning');
  });

  it('boundary 14:00 local => evening', () => {
    // 12:00Z + 2h = 14:00 local Paris (été).
    const result = checkinCta(new Date('2026-07-23T12:00:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('evening');
    expect(result.href).toBe('/checkin/evening');
  });

  it('invalid timezone => falls back to Europe/Paris without throwing', () => {
    // 19:00Z is 21:00 in Paris (été) => evening once safeTimeZone() coerces the
    // bogus tz to the app default.
    expect(() => checkinCta(new Date('2026-07-23T19:00:00Z'), 'Not/AZone')).not.toThrow();
    const result = checkinCta(new Date('2026-07-23T19:00:00Z'), 'Not/AZone');
    expect(result.slot).toBe('evening');
    expect(result.href).toBe('/checkin/evening');
    expect(result.label).toBe('Faire mon check-in du soir');
  });
});
