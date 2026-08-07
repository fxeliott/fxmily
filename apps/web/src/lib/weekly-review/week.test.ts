import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentParisWeekStart, findCurrentWeekReview } from './week';

afterEach(() => {
  vi.useRealTimers();
});

describe('currentParisWeekStart', () => {
  it('returns an ISO date that is a Monday', () => {
    const iso = currentParisWeekStart();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1);
  });

  it('maps any weekday to the preceding Monday of the Paris civil week', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-01T10:00:00Z')); // mercredi
    expect(currentParisWeekStart()).toBe('2026-06-29');

    vi.setSystemTime(new Date('2026-06-29T00:30:00Z')); // le lundi lui-même
    expect(currentParisWeekStart()).toBe('2026-06-29');

    vi.setSystemTime(new Date('2026-07-04T12:00:00Z')); // samedi, milieu de journée
    expect(currentParisWeekStart()).toBe('2026-06-29');
  });

  /**
   * J10 correctif n°1 — LE test qui aurait détecté le défaut.
   *
   * Ces trois instants sont tous des dimanches en UTC et des LUNDIS à Paris
   * (Paris = UTC+2 en été, UTC+1 en hiver). L'ancienne `currentWeekStartUTC`
   * rendait ici la semaine PRÉCÉDENTE, donc `/review/new` proposait au membre
   * d'écrire la revue de la semaine déjà écoulée — et l'upsert
   * `(userId, weekStart)` écrasait celle qu'il avait peut-être déjà remplie.
   *
   * Chaque ligne échoue si l'ancre repasse en UTC.
   */
  it('opens the new week at Paris midnight, not at UTC midnight (regression J10-1)', () => {
    vi.useFakeTimers();

    // Été (CEST, UTC+2) : dimanche 22:30 UTC = lundi 00:30 Paris.
    vi.setSystemTime(new Date('2026-07-05T22:30:00Z'));
    expect(currentParisWeekStart()).toBe('2026-07-06');

    // Été, dernière minute avant minuit UTC : lundi 01:59 Paris.
    vi.setSystemTime(new Date('2026-07-05T23:59:00Z'));
    expect(currentParisWeekStart()).toBe('2026-07-06');

    // Hiver (CET, UTC+1) : dimanche 23:30 UTC = lundi 00:30 Paris.
    vi.setSystemTime(new Date('2026-01-11T23:30:00Z'));
    expect(currentParisWeekStart()).toBe('2026-01-12');
  });

  it('does not open the new week before Paris midnight', () => {
    vi.useFakeTimers();

    // Été : dimanche 21:59 UTC = dimanche 23:59 Paris — encore la semaine en cours.
    vi.setSystemTime(new Date('2026-07-05T21:59:00Z'));
    expect(currentParisWeekStart()).toBe('2026-06-29');

    // Hiver : dimanche 22:59 UTC = dimanche 23:59 Paris.
    vi.setSystemTime(new Date('2026-01-11T22:59:00Z'));
    expect(currentParisWeekStart()).toBe('2026-01-05');
  });

  it('agrees with the reminder anchor, which was already on Paris time', async () => {
    // `weekly-review/reminders.ts` importe `currentParisWeekStart` de
    // `@/lib/calendar/week` depuis J2 : le rappel et la revue doivent nommer
    // la MÊME semaine, sinon le membre est relancé pour une semaine que le
    // formulaire ne lui propose pas.
    const { currentParisWeekStart: calendarAnchor } = await import('@/lib/calendar/week');
    vi.useFakeTimers();

    for (const instant of [
      '2026-07-05T22:30:00Z',
      '2026-01-11T23:30:00Z',
      '2026-03-29T01:30:00Z', // bascule heure d'été FR
      // La bascule vers l'heure d'hiver EST la donnée testée : c'est l'instant
      // où Paris repasse de UTC+2 à UTC+1. Une date relative ne le désignerait
      // pas, et ce fait calendaire restera vrai indéfiniment.
      '2026-10-25T01:30:00Z', // allow-absolute-date bascule DST FR, fait calendaire fixe
    ]) {
      vi.setSystemTime(new Date(instant));
      expect(currentParisWeekStart()).toBe(calendarAnchor());
    }
  });
});

describe('findCurrentWeekReview (loader for the "existing review this week" signal)', () => {
  const thisWeek = { id: 'rev-2', weekStart: '2026-06-29' };
  const lastWeek = { id: 'rev-1', weekStart: '2026-06-22' };

  it('returns the review whose weekStart matches the current week', () => {
    expect(findCurrentWeekReview([thisWeek, lastWeek], '2026-06-29')).toBe(thisWeek);
  });

  it('returns null when only previous weeks have reviews', () => {
    expect(findCurrentWeekReview([lastWeek], '2026-06-29')).toBeNull();
  });

  it('returns null on an empty list (member never reviewed)', () => {
    expect(findCurrentWeekReview([], '2026-06-29')).toBeNull();
  });
});
