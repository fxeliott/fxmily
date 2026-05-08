import 'server-only';

import { localDateOf, parseLocalDate, type LocalDateString } from '@/lib/checkin/timezone';

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
 * Convert a local wall-clock moment (local-date YYYY-MM-DD + h/m/s/ms) to a
 * UTC instant, given an IANA timezone.
 *
 * Algorithm :
 *   1. Build "fake UTC" — interpret the local moment as if it were UTC.
 *   2. Look up the TZ's UTC offset at that instant via `Intl`.
 *   3. Real UTC = fake UTC - offset.
 *
 * Handles DST automatically because `Intl.DateTimeFormat` returns the *actual*
 * offset for the queried instant. For the rare "ambiguous local time" case
 * (DST fallback hour) we accept the Intl-default resolution (typically the
 * later occurrence) — fine for our 7-day window granularity.
 */
export function localInstantToUtc(
  localDate: LocalDateString,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezone: string,
): Date {
  const [yearStr, monthStr, dayStr] = localDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const fakeUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  const offsetMin = getTimezoneOffsetMinutes(fakeUtc, timezone);
  return new Date(fakeUtc.getTime() - offsetMin * 60_000);
}

function getTimezoneOffsetMinutes(instant: Date, timezone: string): number {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const num = (t: string): number => {
    const part = parts.find((p) => p.type === t);
    return part ? Number(part.value) : 0;
  };
  // `Intl` may render hour=24 at midnight in some locales — guard.
  const hour = num('hour') === 24 ? 0 : num('hour');
  const localAsUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    hour,
    num('minute'),
    num('second'),
  );
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
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
// second import line.
export { MS_PER_DAY };
