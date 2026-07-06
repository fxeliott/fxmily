import { describe, expect, it } from 'vitest';

import {
  computeMonthWindow,
  computeReportingMonth,
  monthWindowFromMonthStart,
} from './month-window';

/**
 * SPEC §25 — civil-month window. Carbon of `week-window.test.ts` posture:
 * pin the calendar maths (leap year, month length, year rollover), the
 * Europe/Paris CET↔CEST offset, the previous-full-month anchor across
 * timezones, and the DST-spanning month hour count.
 */

const PARIS = 'Europe/Paris';

describe('computeMonthWindow — civil month containing `now`', () => {
  it('a mid-May Paris instant → 2026-05-01 .. 2026-05-31', () => {
    const w = computeMonthWindow(new Date('2026-05-15T12:00:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2026-05-01');
    expect(w.monthEndLocal).toBe('2026-05-31');
    // Paris CEST (UTC+2) in May → local 1st 00:00 = Apr 30 22:00 UTC.
    expect(w.monthStartUtc.toISOString()).toBe('2026-04-30T22:00:00.000Z');
    // local May 31 23:59:59.999 = May 31 21:59:59.999 UTC.
    expect(w.monthEndUtc.toISOString()).toBe('2026-05-31T21:59:59.999Z');
  });

  it('February non-leap year ends on the 28th', () => {
    const w = computeMonthWindow(new Date('2026-02-10T12:00:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2026-02-01');
    expect(w.monthEndLocal).toBe('2026-02-28');
  });

  it('February leap year ends on the 29th', () => {
    const w = computeMonthWindow(new Date('2028-02-10T12:00:00Z'), PARIS); // allow-absolute-date injected-clock-anchor
    expect(w.monthEndLocal).toBe('2028-02-29'); // allow-absolute-date injected-clock-anchor
  });

  it('30-day and 31-day months are correct', () => {
    expect(computeMonthWindow(new Date('2026-04-10T12:00:00Z'), PARIS).monthEndLocal).toBe(
      '2026-04-30',
    );
    expect(computeMonthWindow(new Date('2026-01-10T12:00:00Z'), PARIS).monthEndLocal).toBe(
      '2026-01-31',
    );
  });

  it('Paris CET (winter) → local 1st 00:00 is UTC+1', () => {
    const w = computeMonthWindow(new Date('2026-01-15T12:00:00Z'), PARIS);
    expect(w.monthStartUtc.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(w.monthEndUtc.toISOString()).toBe('2026-01-31T22:59:59.999Z');
  });

  it('a DST-spanning month (March: CET→CEST) is ~743h, not 744h', () => {
    const w = computeMonthWindow(new Date('2026-03-15T12:00:00Z'), PARIS);
    const hours = Math.round(
      (w.monthEndUtc.getTime() - w.monthStartUtc.getTime()) / (60 * 60 * 1000),
    );
    // 31 calendar days = 744h, minus 1h lost on the spring-forward = 743h.
    expect(hours).toBe(743);
  });
});

describe('computeReportingMonth — previous full civil month', () => {
  it('batch fires 1 June 02:00 UTC → reports May (Paris)', () => {
    const w = computeReportingMonth(new Date('2026-06-01T02:00:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2026-05-01');
    expect(w.monthEndLocal).toBe('2026-05-31');
  });

  it('year rollover: batch fires 1 Jan → reports the previous December', () => {
    const w = computeReportingMonth(new Date('2027-01-01T02:00:00Z'), PARIS); // allow-absolute-date injected-clock-anchor
    expect(w.monthStartLocal).toBe('2026-12-01'); // allow-absolute-date injected-clock-anchor
    expect(w.monthEndLocal).toBe('2026-12-31'); // allow-absolute-date injected-clock-anchor
  });

  it('previous month is February in a leap year → ends on the 29th', () => {
    const w = computeReportingMonth(new Date('2028-03-01T02:00:00Z'), PARIS); // allow-absolute-date injected-clock-anchor
    expect(w.monthStartLocal).toBe('2028-02-01'); // allow-absolute-date injected-clock-anchor
    expect(w.monthEndLocal).toBe('2028-02-29'); // allow-absolute-date injected-clock-anchor
  });

  it.each([
    ['Europe/Paris', '2026-05-01', '2026-05-31'],
    ['Asia/Tokyo', '2026-05-01', '2026-05-31'],
    ['America/New_York', '2026-05-01', '2026-05-31'],
    ['UTC', '2026-05-01', '2026-05-31'],
  ])('multi-TZ %s: a June run resolves to the full completed May', (tz, start, end) => {
    // Ancre 2 juin 12:00 UTC : c'est juin local pour TOUTES les TZ testées
    // (NY = 2 juin 08:00, Tokyo = 2 juin 21:00) — donc le mois courant est juin
    // partout et le recul 1ms cible mai sans ambiguïté. (L'ancien test ancrait
    // 1er juin 02:00 UTC, instant où NY est encore le 31 mai : avec la sémantique
    // robuste « dernier mois COMPLÉTÉ en local », mai n'est PAS encore terminé
    // pour NY à cet instant — l'ancienne ancre `now − 24h` masquait ce fait. On
    // teste donc un instant opérationnellement réaliste pour un membre far-west.)
    const w = computeReportingMonth(new Date('2026-06-02T12:00:00Z'), tz);
    expect(w.monthStartLocal).toBe(start);
    expect(w.monthEndLocal).toBe(end);
  });

  it('early-1st run (00:05 Paris) targets the just-completed month', () => {
    // Le batch lancé tôt le 1er juin (00:05 Paris = 31 mai 22:05 UTC en CEST)
    // doit cibler MAI — le mois courant est juin, recul 1ms → mai.
    const w = computeReportingMonth(new Date('2026-05-31T22:05:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2026-05-01');
    expect(w.monthEndLocal).toBe('2026-05-31');
  });

  it.each([
    ['5 juin (run retardé de 4j)', '2026-06-05T08:00:00Z'],
    ['20 juin (run retardé de 19j)', '2026-06-20T08:00:00Z'],
    ['dernier jour du mois (30 juin 23:00 Paris)', '2026-06-30T21:00:00Z'],
  ])(
    'DELAYED run %s still targets the previous completed month (May), never the current (June)',
    (_label, iso) => {
      // RÉGRESSION FIX TIER1 : l'ancien `now − 24h` ciblait JUIN (mois courant
      // incomplet) pour tout run après ~le 1er → mai jamais générée + boucle de
      // nudge infinie. Le calcul « mois courant → recul 1ms » est robuste quel
      // que soit le délai du run : le mois courant reste juin → on cible mai.
      const w = computeReportingMonth(new Date(iso), PARIS);
      expect(w.monthStartLocal).toBe('2026-05-01');
      expect(w.monthEndLocal).toBe('2026-05-31');
    },
  );

  it('batch et net overdue convergent : même monthStart pour un run early-1st ET retardé', () => {
    // Le coeur du fix B : `computeReportingMonth` (source du batch via le
    // loader) et `lastCompletedMonth` (net overdue, qui délègue désormais à
    // `computeReportingMonth`) renvoient le MÊME mois quel que soit le jour —
    // donc plus de divergence batch/net → plus de boucle de nudge.
    const early = computeReportingMonth(new Date('2026-05-31T22:05:00Z'), PARIS);
    const delayed = computeReportingMonth(new Date('2026-06-05T08:00:00Z'), PARIS);
    expect(early.monthStartLocal).toBe(delayed.monthStartLocal);
    expect(delayed.monthStartLocal).toBe('2026-05-01');
  });
});

describe('monthWindowFromMonthStart — deterministic admin recompute', () => {
  it('round-trips a persisted monthStart to the exact same window', () => {
    const reported = computeReportingMonth(new Date('2026-06-01T02:00:00Z'), PARIS);
    const recomputed = monthWindowFromMonthStart(reported.monthStartLocal, PARIS);
    expect(recomputed).toEqual(reported);
  });

  it('the recomputed monthEnd is service-derived, never trusted from input', () => {
    // Even if a caller passes only the 1st, monthEnd is computed (28..31).
    expect(monthWindowFromMonthStart('2026-02-01', PARIS).monthEndLocal).toBe('2026-02-28');
    expect(monthWindowFromMonthStart('2028-02-01', PARIS).monthEndLocal).toBe('2028-02-29'); // allow-absolute-date injected-clock-anchor
  });
});
