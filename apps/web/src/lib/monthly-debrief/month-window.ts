import 'server-only';

import { localDateOf, parseLocalDate, type LocalDateString } from '@/lib/checkin/timezone';
import { localInstantToUtc } from '@/lib/weekly-report/week-window';

/**
 * Civil-month window helpers for the V1.4 monthly AI debrief (SPEC §25).
 *
 * The monthly batch (SPEC §25.4) runs on the 1st of the month and emits 1
 * debrief per active member, covering the **previous full civil month** in
 * the member's timezone (1st 00:00:00 → last-day 23:59:59.999 local-time,
 * expressed as UTC instants).
 *
 * V1 cohort is Europe/Paris-only in practice, but `User.timezone` already
 * exists so we honor it from day 1 — same posture as `weekly-report/
 * week-window.ts` (this module is its civil-month carbon: it reuses
 * `localInstantToUtc` / `shiftLocalDateString` / `parseLocalDate` /
 * `localDateOf` rather than re-deriving the DST-safe Intl maths).
 *
 * Importing `@/lib/weekly-report/week-window` is §21.5-clean: it is pure
 * date arithmetic with zero training reference and is NOT a real-edge
 * surface (the anti-leak Block A globs `lib/weekly-report/builder.ts`
 * only). WeeklyReport is the sanctioned INPUT source for the monthly
 * debrief (SPEC §25.3) — the §25 firewall is about training-P&L isolation,
 * not weekly-report isolation. See `test/anti-leak/training-isolation.test.ts`
 * Block G.
 */

export interface MonthWindow {
  /// YYYY-MM-01 (1st of the civil month, member-local).
  monthStartLocal: LocalDateString;
  /// YYYY-MM-DD (last calendar day of the civil month, member-local).
  monthEndLocal: LocalDateString;
  /// UTC instant: member-local 1st-of-month 00:00:00.000 in `timezone`.
  monthStartUtc: Date;
  /// UTC instant: member-local last-day 23:59:59.999 in `timezone`.
  monthEndUtc: Date;
}

/** First day (`YYYY-MM-01`) of the civil month a local date belongs to. */
function firstOfMonth(local: LocalDateString): LocalDateString {
  const [y, m] = local.split('-');
  return `${y}-${m}-01`;
}

/**
 * Compute the civil-month window **containing** `now` in the member's TZ
 * (the "current month" semantic — mirror `computeWeekWindow`).
 *
 * The last day of the month is derived branch-free via `Date.UTC(y, m, 0)`
 * (day 0 of the *next* month = last day of the queried month), which is
 * leap-year correct (Feb 28/29) without a lookup table.
 */
export function computeMonthWindow(now: Date, timezone: string): MonthWindow {
  const todayLocal = localDateOf(now, timezone);
  const monthStartLocal = firstOfMonth(todayLocal);

  const [yStr, mStr] = monthStartLocal.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1-based
  // Day 0 of the next month = last calendar day of THIS month (28/29/30/31).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEndLocal: LocalDateString = `${yStr}-${mStr}-${`${lastDay}`.padStart(2, '0')}`;

  return {
    monthStartLocal,
    monthEndLocal,
    monthStartUtc: localInstantToUtc(monthStartLocal, 0, 0, 0, 0, timezone),
    monthEndUtc: localInstantToUtc(monthEndLocal, 23, 59, 59, 999, timezone),
  };
}

/**
 * "Reporting month" — the most-recently-completed civil month in the
 * member's local timezone, for the 1st-of-month batch run. **Exact carbon
 * of `computeReportingWeek`** (SPEC §25.4 "ancre now − Xj multi-TZ-safe
 * comme computeReportingWeek"): anchor on `now − 24h`, then take the civil
 * month *containing* that instant.
 *
 * Contract (mirror weekly's "fires Sunday 21:00 UTC"): the batch is
 * ops-scheduled to fire **early on the 1st of the month**. `now − 24h`
 * then lands on the last day of the just-ended month for every realistic
 * timezone (Baker UTC−12 .. Kiribati UTC+14, since the last day ∓ 14h is
 * still inside a ≥28-day month), so `computeMonthWindow` returns exactly
 * the month to report. One rule, no branching, DST-safe (24h ≫ the ±1h
 * DST jump) — identical robustness envelope as `computeReportingWeek`
 * (which likewise does not special-case a multi-day-delayed run; the
 * idempotent `(userId, monthStart)` upsert covers any re-run).
 *
 * Why NOT "previous month of today_local": for a timezone west of UTC a
 * batch firing 02:00 UTC on the 1st is still the previous month's last
 * day *locally* — stepping back another month would skip to two-months-
 * ago (caught by `month-window.test.ts` multi-TZ NY case).
 */
export function computeReportingMonth(now: Date, timezone: string): MonthWindow {
  const anchored = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return computeMonthWindow(anchored, timezone);
}

/**
 * Recompute the exact window of an already-persisted debrief from its
 * `monthStart` (`YYYY-MM-DD`, member-local 1st-of-month). Deterministic
 * SSOT used by the admin read path so a recomputed view never drifts from
 * what the batch persisted. `monthEnd` is ALWAYS service-computed here,
 * never accepted from a client (anti-tamper, SPEC §25.3/§25.7).
 */
export function monthWindowFromMonthStart(
  monthStartLocal: LocalDateString,
  timezone: string,
): MonthWindow {
  const ref = parseLocalDate(monthStartLocal); // UTC midnight of the 1st
  return computeMonthWindow(ref, timezone);
}
