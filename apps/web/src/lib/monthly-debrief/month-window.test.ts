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
    const w = computeMonthWindow(new Date('2028-02-10T12:00:00Z'), PARIS);
    expect(w.monthEndLocal).toBe('2028-02-29');
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
    const w = computeReportingMonth(new Date('2027-01-01T02:00:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2026-12-01');
    expect(w.monthEndLocal).toBe('2026-12-31');
  });

  it('previous month is February in a leap year → ends on the 29th', () => {
    const w = computeReportingMonth(new Date('2028-03-01T02:00:00Z'), PARIS);
    expect(w.monthStartLocal).toBe('2028-02-01');
    expect(w.monthEndLocal).toBe('2028-02-29');
  });

  it.each([
    ['Europe/Paris', '2026-05-01', '2026-05-31'],
    ['Asia/Tokyo', '2026-05-01', '2026-05-31'],
    ['America/New_York', '2026-05-01', '2026-05-31'],
    ['UTC', '2026-05-01', '2026-05-31'],
  ])('multi-TZ %s: 1 June batch resolves to the full May', (tz, start, end) => {
    const w = computeReportingMonth(new Date('2026-06-01T02:00:00Z'), tz);
    expect(w.monthStartLocal).toBe(start);
    expect(w.monthEndLocal).toBe(end);
  });

  it('the 24h anchor matches computeReportingWeek (fires-on-the-1st contract)', () => {
    // Identical envelope to computeReportingWeek: a batch firing anywhere in
    // the early hours of the 1st resolves to the just-ended month for the V1
    // cohort. A multi-day-delayed run is out of contract (same limitation as
    // weekly's Sunday-21:00 anchor) — the (userId, monthStart) upsert covers
    // a re-run, never a wrong-month duplicate.
    expect(computeReportingMonth(new Date('2026-06-01T00:30:00Z'), PARIS).monthStartLocal).toBe(
      '2026-05-01',
    );
    expect(
      computeReportingMonth(new Date('2026-06-01T06:00:00Z'), 'Asia/Tokyo').monthStartLocal,
    ).toBe('2026-05-01');
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
    expect(monthWindowFromMonthStart('2028-02-01', PARIS).monthEndLocal).toBe('2028-02-29');
  });
});
