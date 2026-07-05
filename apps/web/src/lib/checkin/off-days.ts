import 'server-only';

import { cache } from 'react';

import { db } from '@/lib/db';

import { parseLocalDate, type LocalDateString } from './timezone';

/**
 * Off-day ("jour off") predicates + service (Tour 14).
 *
 * Product semantics — a "pont" over the streak / constancy surfaces:
 *   - A day is OFF when it is a weekend AND the member keeps weekends off
 *     (`User.weekendsOff`, the default), OR it is an EXPLICITLY declared
 *     `MemberOffDay`.
 *   - An off day does NOT count toward the streak and does NOT break it (the
 *     backward walk steps over it), drops out of the fill-rate denominator,
 *     silences the reminder + the forgot/discrepancy accusation.
 *   - A real check-in filed ON an off day still counts 100 %: the off-day
 *     status only ever REMOVES pressure, never a filled entry (the rempli wins).
 *
 * The predicates are pure (string-in) so the streak walker and the scoring
 * denominator can consume them without a DB round-trip; the service resolves
 * the member's weekend flag + explicit dates once and hands back a context.
 */

/**
 * True iff `localDate` (YYYY-MM-DD) is a Saturday or Sunday. Uses the same
 * `parseLocalDate(...).getUTCDay()` idiom as `week-window.ts:dayOfWeekIso`: the
 * parse anchors at UTC midnight of the civil day, so the weekday is stable and
 * timezone-agnostic (it depends only on the calendar date, never the time).
 */
export function isWeekendLocalDate(localDate: LocalDateString): boolean {
  const dow = parseLocalDate(localDate).getUTCDay(); // 0 = Sun … 6 = Sat
  return dow === 0 || dow === 6;
}

/**
 * The resolved off-day inputs for a single member over a window: their weekend
 * preference + the set of local-date strings they explicitly declared off.
 */
export interface OffDayContext {
  /** `User.weekendsOff` — weekends count as off when true (the default). */
  weekendsOff: boolean;
  /** Explicit `MemberOffDay.date` strings (YYYY-MM-DD) in the window. */
  explicitDates: ReadonlySet<LocalDateString>;
}

/**
 * Pure off-day predicate. A day is off when the member declared it explicitly
 * OR it is a weekend and the member keeps weekends off. Composes with the
 * streak walker and the scoring denominator (both string-keyed).
 */
export function isOffDay(
  localDate: LocalDateString,
  opts: { weekendsOff: boolean; explicitDates: ReadonlySet<LocalDateString> },
): boolean {
  if (opts.explicitDates.has(localDate)) return true;
  return opts.weekendsOff && isWeekendLocalDate(localDate);
}

/**
 * Resolve a member's {@link OffDayContext} over `[fromLocalDate, toLocalDate]`
 * (inclusive). ONE indexed range query on `member_off_days` plus the user's
 * `weekendsOff` flag. Wrapped in React `cache()` (mirror `getStreak`): several
 * surfaces (streak, reminder copy, scoring) each need the same member's off-day
 * context during ONE server render — per-request memoisation collapses the
 * duplicate `(userId, from, to)` calls into a single query chain.
 *
 * Bounds are the member's LOCAL civil-date strings (same frame as the
 * `@db.Date` column), fed through `parseLocalDate` to the UTC-midnight pins the
 * column stores. Returns `weekendsOff = true` as a safe default when the user
 * row is missing (mirrors the Europe/Paris timezone fallback elsewhere).
 */
export const getOffDaySet = cache(
  async (
    userId: string,
    fromLocalDate: LocalDateString,
    toLocalDate: LocalDateString,
  ): Promise<OffDayContext> => {
    const [user, rows] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { weekendsOff: true } }),
      db.memberOffDay.findMany({
        where: {
          userId,
          date: { gte: parseLocalDate(fromLocalDate), lte: parseLocalDate(toLocalDate) },
        },
        select: { date: true },
      }),
    ]);
    const explicitDates = new Set<LocalDateString>(
      rows.map((r) => r.date.toISOString().slice(0, 10)),
    );
    return { weekendsOff: user?.weekendsOff ?? true, explicitDates };
  },
);
