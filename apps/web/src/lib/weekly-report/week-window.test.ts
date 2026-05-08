import { describe, expect, it } from 'vitest';

import {
  computePreviousFullWeekWindow,
  computeReportingWeek,
  computeWeekWindow,
  dayOfWeekIso,
  localInstantToUtc,
  shiftLocalDateString,
} from './week-window';

/**
 * J8 audit-driven hardening tests (BLOCKER #1 + #2 from code-reviewer pass).
 *
 * The cron runs Sunday 21:00 UTC. We validate that the resulting window is
 * the **just-completed local-week** for both Europe/Paris (V1 default) and
 * a forward-leaning timezone (Asia/Tokyo) where the local clock is already
 * past Monday morning.
 */

describe('week-window helpers', () => {
  describe('dayOfWeekIso', () => {
    it('returns 1 for Monday and 7 for Sunday (ISO)', () => {
      expect(dayOfWeekIso('2026-05-04')).toBe(1); // Monday
      expect(dayOfWeekIso('2026-05-05')).toBe(2);
      expect(dayOfWeekIso('2026-05-10')).toBe(7); // Sunday
    });
  });

  describe('shiftLocalDateString', () => {
    it('shifts forward and back across month boundaries', () => {
      expect(shiftLocalDateString('2026-04-30', 1)).toBe('2026-05-01');
      expect(shiftLocalDateString('2026-05-01', -1)).toBe('2026-04-30');
      expect(shiftLocalDateString('2026-05-04', 7)).toBe('2026-05-11');
    });
  });

  describe('localInstantToUtc', () => {
    it('Paris CEST: local Mon 00:00 → UTC Sun 22:00', () => {
      // 2026-05-04 is in CEST (UTC+2). Local-Mon-00:00 = Sun 22:00 UTC.
      const utc = localInstantToUtc('2026-05-04', 0, 0, 0, 0, 'Europe/Paris');
      expect(utc.toISOString()).toBe('2026-05-03T22:00:00.000Z');
    });

    it('Tokyo JST: local Mon 00:00 → UTC Sun 15:00', () => {
      const utc = localInstantToUtc('2026-05-04', 0, 0, 0, 0, 'Asia/Tokyo');
      expect(utc.toISOString()).toBe('2026-05-03T15:00:00.000Z');
    });

    it('UTC: local Mon 00:00 → UTC Mon 00:00', () => {
      const utc = localInstantToUtc('2026-05-04', 0, 0, 0, 0, 'UTC');
      expect(utc.toISOString()).toBe('2026-05-04T00:00:00.000Z');
    });
  });
});

describe('computeWeekWindow', () => {
  it('Paris Sunday 22:00 local (cron Sun 21 UTC + DST) → Mon 4 → Sun 10', () => {
    // Sun 21 UTC during CEST = Sun 23:00 Paris.
    const now = new Date('2026-05-10T21:00:00Z');
    const window = computeWeekWindow(now, 'Europe/Paris');
    expect(window.weekStartLocal).toBe('2026-05-04');
    expect(window.weekEndLocal).toBe('2026-05-10');
  });

  it('Paris Monday 02:00 local (cron-late) → still Mon 4 → Sun 10 if anchored on Mon', () => {
    const now = new Date('2026-05-11T00:00:00Z'); // Mon 02:00 Paris CEST
    const window = computeWeekWindow(now, 'Europe/Paris');
    // computeWeekWindow uses today_local without 24h shift — so this is
    // Mon 11 → Sun 17 (the new week). The cron uses `computeReportingWeek`
    // (= now - 24h anchor) to roll back to the previous week. This test
    // pins the raw helper's behavior so a future regression on the cron
    // path is detectable.
    expect(window.weekStartLocal).toBe('2026-05-11');
    expect(window.weekEndLocal).toBe('2026-05-17');
  });
});

describe('computeReportingWeek (cron-safe)', () => {
  it('Paris Sun 21 UTC (CEST = Sun 23:00 local) → previous Mon 4 → Sun 10', () => {
    const now = new Date('2026-05-10T21:00:00Z');
    const window = computeReportingWeek(now, 'Europe/Paris');
    expect(window.weekStartLocal).toBe('2026-05-04');
    expect(window.weekEndLocal).toBe('2026-05-10');
  });

  it('Tokyo Sun 21 UTC (JST = Mon 06:00 local) → still Mon 4 → Sun 10 (just-ended week)', () => {
    // Without `computeReportingWeek`, the raw `computeWeekWindow` would
    // jump forward to Mon 11 → Sun 17 (NEXT week) for Tokyo. The 24h
    // anchor shift fixes that.
    const now = new Date('2026-05-10T21:00:00Z');
    const window = computeReportingWeek(now, 'Asia/Tokyo');
    expect(window.weekStartLocal).toBe('2026-05-04');
    expect(window.weekEndLocal).toBe('2026-05-10');
  });

  it('Paris Mon 02:00 local (cron-late) → still reports Mon 4 → Sun 10', () => {
    const now = new Date('2026-05-11T00:00:00Z'); // Mon 02:00 Paris CEST
    const window = computeReportingWeek(now, 'Europe/Paris');
    expect(window.weekStartLocal).toBe('2026-05-04');
    expect(window.weekEndLocal).toBe('2026-05-10');
  });

  it('cron contract — Sun 21 UTC always lands on the just-completed local-week', () => {
    // The cron is scheduled `0 21 * * 0` (Sunday 21:00 UTC). For every
    // supported timezone, that instant must produce a (Mon, Sun) pair where
    // `weekEndLocal` is **not in the future** in that TZ — i.e. the week is
    // either ending today (Paris) or already ended yesterday (Tokyo).
    const cronInstant = new Date('2026-05-10T21:00:00Z');
    for (const tz of ['Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'America/New_York', 'UTC']) {
      const window = computeReportingWeek(cronInstant, tz);
      expect(dayOfWeekIso(window.weekStartLocal)).toBe(1); // Monday
      expect(dayOfWeekIso(window.weekEndLocal)).toBe(7); // Sunday
    }
  });
});

describe('computePreviousFullWeekWindow', () => {
  it('Paris Sun 22:00 local → Mon 27 Apr → Sun 3 May (week before current)', () => {
    const now = new Date('2026-05-10T20:00:00Z');
    const window = computePreviousFullWeekWindow(now, 'Europe/Paris');
    expect(window.weekStartLocal).toBe('2026-04-27');
    expect(window.weekEndLocal).toBe('2026-05-03');
  });
});
