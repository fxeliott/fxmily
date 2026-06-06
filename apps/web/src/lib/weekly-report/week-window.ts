import 'server-only';

import {
  localDateOf,
  localInstantToUtc,
  parseLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';

/**
 * Week-window helpers for the J8 weekly report (Phase B).
 *
 * The cron (SPEC §7.10) runs Sunday 21:00 UTC and emits 1 report per active
 * member, covering the **local-week that contains "today"** in the member's
 * timezone (Mon 00:00:00 → Sun 23:59:59.999 local-time, expressed as UTC
 * instants).
 *
 * V1 is Europe/Paris-only in practice, but the User.timezone column already
 * exists so we honor it from day 1 — same posture as J5 + J6 + J7.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the week boundaries for a given `now` instant in the member's TZ.
 *
 * Rules :
 *   - `weekEnd_local`   = the local-Sunday of the week that contains "today_local"
 *   - `weekStart_local` = `weekEnd_local - 6 days`
 *   - Returned UTC instants represent **local Monday 00:00:00.000 → local
 *     Sunday 23:59:59.999** in the user's timezone.
 *
 * The TZ offset is computed via `Intl.DateTimeFormat` (Node 22 LTS bundles full
 * ICU) — no library required. Re-evaluated on each call so DST transitions
 * inside the week are handled correctly (the start instant is computed on
 * weekStart_local, the end instant on weekEnd_local).
 *
 * Returns the `LocalDateString` boundaries too — useful for the snapshot
 * payload + audit logs.
 */
export interface WeekWindow {
  weekStartLocal: LocalDateString; // YYYY-MM-DD (Monday)
  weekEndLocal: LocalDateString; // YYYY-MM-DD (Sunday)
  /// UTC instant: local-Monday 00:00:00.000 in `timezone`.
  weekStartUtc: Date;
  /// UTC instant: local-Sunday 23:59:59.999 in `timezone`.
  weekEndUtc: Date;
}

export function computeWeekWindow(now: Date, timezone: string): WeekWindow {
  const todayLocal = localDateOf(now, timezone);
  const todayDow = dayOfWeekIso(todayLocal); // 1 = Mon … 7 = Sun
  const daysBackToMonday = todayDow - 1;
  const daysToSunday = 7 - todayDow;

  const weekStartLocal = shiftLocalDateString(todayLocal, -daysBackToMonday);
  const weekEndLocal = shiftLocalDateString(todayLocal, daysToSunday);

  return {
    weekStartLocal,
    weekEndLocal,
    weekStartUtc: localInstantToUtc(weekStartLocal, 0, 0, 0, 0, timezone),
    weekEndUtc: localInstantToUtc(weekEndLocal, 23, 59, 59, 999, timezone),
  };
}

/**
 * "Previous full week" — Monday → Sunday of the week BEFORE `now`. Used by the
 * cron when explicitly invoked Monday 00:00 (post-midnight catch-up). Not the
 * default behavior — the SPEC cadence is Sunday 21:00 UTC which lands inside
 * the local week we want to report on.
 */
export function computePreviousFullWeekWindow(now: Date, timezone: string): WeekWindow {
  const current = computeWeekWindow(now, timezone);
  const prevSunday = shiftLocalDateString(current.weekStartLocal, -1);
  const ref = parseLocalDate(prevSunday); // UTC midnight of prev-Sunday
  return computeWeekWindow(ref, timezone);
}

/**
 * "Reporting week" — the most-recently-completed Mon→Sun week in the member's
 * local timezone, suitable for the cron run. Anchors on `now - 24h` so :
 *
 *   - When the cron fires Sun 21:00 UTC and a Paris member is at "Sun 22:00
 *     local-Mon 21:00 anchor → still Saturday 22:00 anchor → containing week
 *     = Mon→Sun (week ending today)" ✓
 *   - When the cron fires Sun 21:00 UTC and a Tokyo member is already at
 *     "Mon 06:00 local, anchor = Sun 06:00 local → week = Mon→Sun (last full
 *     week, NOT next week)" ✓
 *   - When the cron is delayed and re-runs Mon 02:00 UTC for Paris (Mon 04:00
 *     local), anchor = Sun 04:00 local → week = Mon→Sun (last week) ✓
 *
 * Why subtract 24h rather than special-casing "is today Sunday in member TZ":
 * one rule, no branching, DST-safe. The 24h shift is wider than any DST jump
 * (max ±1h) so it never accidentally lands in the wrong calendar week.
 */
export function computeReportingWeek(now: Date, timezone: string): WeekWindow {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return computeWeekWindow(yesterday, timezone);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * ISO day-of-week (1 = Mon … 7 = Sun) for a YYYY-MM-DD string.
 *
 * Uses the UTC midnight Date built from the string (timezone-agnostic — the
 * weekday only depends on the calendar date, not the time).
 */
export function dayOfWeekIso(local: LocalDateString): number {
  const d = parseLocalDate(local);
  // JS `getUTCDay()` : 0 = Sun … 6 = Sat. Convert to ISO: 1 = Mon … 7 = Sun.
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function shiftLocalDateString(s: LocalDateString, days: number): LocalDateString {
  if (days === 0) return s;
  const d = parseLocalDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calendar duration of a {@link WeekWindow} in days. Always 7 by construction
 * but we expose the helper for symmetry with future "partial week" use cases.
 */
export function weekWindowDays(_window: WeekWindow): number {
  return 7;
}

export function diffMs(end: Date, start: Date): number {
  return end.getTime() - start.getTime();
}

export function isInUtcWindow(instant: Date, window: WeekWindow): boolean {
  const t = instant.getTime();
  return t >= window.weekStartUtc.getTime() && t <= window.weekEndUtc.getTime();
}

export function approxWeekHours(window: WeekWindow): number {
  // Useful for DST-week sanity (167h or 169h instead of 168h).
  return Math.round(diffMs(window.weekEndUtc, window.weekStartUtc) / (60 * 60 * 1000));
}

// Re-export so callers can build week-window-relative helpers without a
// second import line. `localInstantToUtc` was relocated to
// `@/lib/checkin/timezone` (neutral tz home) in V1.7 §30 — re-exported here
// (it is already imported above for `computeWeekWindow`) so existing callers
// (`week-window.test.ts`, `monthly-debrief/month-window.ts`) keep working.
export { MS_PER_DAY, localInstantToUtc };
