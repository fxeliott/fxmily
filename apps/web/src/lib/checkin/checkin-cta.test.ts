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

  /**
   * ⚠️ CE COUPLE DE CAS REMPLACE UN TEST QUI NE FALSIFIAIT RIEN.
   *
   * L'ancien s'appelait « 21:00 Europe/Paris en hiver (CET, UTC+1) => evening »
   * et se réclamait d'une preuve : « prouve que l'offset est lu pour l'instant
   * demandé, pas supposé +2 toute l'année ». Mesuré, c'est faux. À
   * `2026-01-15T20:00:00Z`, l'heure locale vraie est 21 h et l'heure d'une
   * implémentation qui supposerait +2 serait 22 h : les deux sont ≥ 14, donc
   * les deux répondent `evening`. Le test passait au vert sur l'implémentation
   * exacte ET sur celle qu'il prétendait exclure. Il ne mesurait que l'heure
   * qu'on lui avait donnée, loin de la seule frontière qui décide.
   *
   * Un cas ne falsifie une hypothèse que s'il tombe LÀ OÙ LES DEUX RÉPONSES
   * DIVERGENT — ici, de part et d'autre de 14 h locales. `12:30Z` est cet
   * endroit, et il sert dans les deux sens :
   *
   *   hiver (CET, +1) : 13:30 vrai → morning | supposé +2 → 14:30 → evening
   *   été   (CEST, +2): 14:30 vrai → evening | supposé +1 → 13:30 → morning
   *
   * Ensemble, ils tuent les deux offsets figés possibles. Un seul des deux ne
   * suffirait pas : le cas d'hiver laisserait passer un helper codé sur +1.
   */
  it('winter 12:30Z => 13:30 CET => morning (kills a helper hardcoded on +2)', () => {
    const result = checkinCta(new Date('2026-01-15T12:30:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('morning');
    expect(result.href).toBe('/checkin/morning');
    expect(result.label).toBe('Faire mon check-in du matin');
  });

  it('summer 12:30Z => 14:30 CEST => evening (kills a helper hardcoded on +1)', () => {
    const result = checkinCta(new Date('2026-07-15T12:30:00Z'), 'Europe/Paris');
    expect(result.slot).toBe('evening');
    expect(result.href).toBe('/checkin/evening');
    expect(result.label).toBe('Faire mon check-in du soir');
  });

  it('the SAME wall-clock 12:30Z flips slot between the two DST halves of the year', () => {
    // La formulation la plus directe de la règle : à heure UTC identique, le
    // même fuseau ne répond pas la même chose en janvier et en juillet. Aucune
    // implémentation à offset figé ne peut satisfaire cette assertion.
    const winter = checkinCta(new Date('2026-01-15T12:30:00Z'), 'Europe/Paris');
    const summer = checkinCta(new Date('2026-07-15T12:30:00Z'), 'Europe/Paris');
    expect(winter.slot).not.toBe(summer.slot);
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

  /**
   * SCOPE 4 blind spot: every case above pins a SINGLE zone (Europe/Paris, or an
   * invalid one that falls back to it), so an implementation that ignored the
   * `timezone` argument entirely and always read the Paris hour would still pass
   * them. The three cases below break that phantom implementation: they hold the
   * UTC instant CONSTANT and vary only the zone, so the slot can only differ if
   * the argument is actually honoured.
   *
   * Anchor instant: 2026-07-27T05:00:00Z
   *   Asia/Tokyo       UTC+9  => 14:00 local => evening (>= 14)
   *   America/New_York EDT-4  => 01:00 local => morning (< 14)
   *   Europe/Paris     CEST+2 => 07:00 local => morning (control: the naive
   *                                             implementation's answer)
   * Tokyo is therefore the one that a Paris-hardcoded helper would get wrong.
   */
  const SAME_INSTANT = '2026-07-27T05:00:00Z';

  it('Asia/Tokyo at 05:00Z => 14:00 local => evening (fails a Paris-hardcoded helper)', () => {
    const result = checkinCta(new Date(SAME_INSTANT), 'Asia/Tokyo');
    expect(result.slot).toBe('evening');
  });

  it('America/New_York at the SAME instant => 01:00 local => morning', () => {
    const result = checkinCta(new Date(SAME_INSTANT), 'America/New_York');
    expect(result.slot).toBe('morning');
  });

  it('same instant, opposite slots: href and label follow the slot of EACH timezone', () => {
    const now = new Date(SAME_INSTANT);
    const tokyo = checkinCta(now, 'Asia/Tokyo');
    const newYork = checkinCta(now, 'America/New_York');

    // The two zones disagree at the very same moment: that IS the SCOPE 4 rule.
    expect(tokyo.slot).not.toBe(newYork.slot);

    expect(tokyo).toEqual({
      slot: 'evening',
      href: '/checkin/evening',
      label: 'Faire mon check-in du soir',
    });
    expect(newYork).toEqual({
      slot: 'morning',
      href: '/checkin/morning',
      label: 'Faire mon check-in du matin',
    });

    // Control: Paris is 07:00 at that instant, i.e. morning. A helper that
    // ignored `timezone` would return this for Tokyo too.
    expect(checkinCta(now, 'Europe/Paris').slot).toBe('morning');
  });
});
