import { shiftLocalDate, type LocalDateString } from './timezone';

/**
 * Streak counter (J5, SPEC §7.4 + J6 engagement scoring).
 *
 * "Streak" = number of consecutive days (in the user's local TZ) where they
 * filed at least one check-in. The walk starts from `today` and steps
 * backwards day by day until it hits a gap.
 *
 * Today is included only if a check-in exists for today — a member who hasn't
 * checked in yet today still has yesterday's streak. The streak only breaks
 * once both today AND yesterday have passed without a check-in.
 *
 * Pure function on a list of `(date, slots)` rows so tests don't need a DB.
 * Service layer (`lib/checkin/service.ts`) feeds it.
 */

export type CheckinSlotName = 'morning' | 'evening';

export interface CheckinDay {
  /** Local-date string YYYY-MM-DD. */
  date: LocalDateString;
  /** Slots filed for that date. At least one. */
  slots: CheckinSlotName[];
}

/**
 * Count consecutive days with ≥1 check-in ending at `today`.
 *
 * @param days     Pre-fetched check-in rows. Order doesn't matter; duplicates
 *                 are tolerated (we collapse to a Set of dates internally).
 * @param today    The "today" anchor in the user's local TZ (YYYY-MM-DD). Use
 *                 `localDateOf(new Date(), user.timezone)` upstream.
 * @param isOffDay Optional off-day predicate (Tour 14). An off day the member
 *                 did NOT fill is a "pont": the backward walk STEPS OVER it —
 *                 it neither counts toward the streak nor breaks it. A day the
 *                 member DID fill always counts, even if it is off (the rempli
 *                 wins). Omit it (or pass `undefined`) for the pre-Tour-14
 *                 behaviour, byte-identical (no day is ever off).
 */
export function computeStreak(
  days: readonly CheckinDay[],
  today: LocalDateString,
  isOffDay?: (localDate: LocalDateString) => boolean,
): number {
  if (days.length === 0) return 0;

  // Collapse to a Set of dates with ≥1 check-in. Future-dated rows (clock skew)
  // are filtered out: they shouldn't influence today's streak.
  const filledDates = new Set<LocalDateString>();
  for (const d of days) {
    if (d.slots.length > 0 && d.date <= today) filledDates.add(d.date);
  }

  if (filledDates.size === 0) return 0;

  // A day contributes to the run when it is filled; an UNFILLED off day is
  // transparent (skipped, never a break); an unfilled non-off day breaks it.
  const filled = (d: LocalDateString): boolean => filledDates.has(d);
  const off = (d: LocalDateString): boolean => (isOffDay ? isOffDay(d) : false);

  // Find the anchor: the most recent day at/just before `today` that is filled,
  // stepping over unfilled off days (a weekend the member took off must not
  // break a Friday→Monday streak). Today itself is optional — a member who
  // hasn't checked in yet today still holds yesterday's streak — so we allow at
  // most ONE unfilled, non-off day (today) before requiring a filled anchor.
  let cursor = today;
  if (!filled(cursor)) {
    // Skip leading unfilled off days (e.g. an off weekend before today).
    while (off(cursor) && !filled(cursor)) cursor = shiftLocalDate(cursor, -1);
    if (!filled(cursor)) {
      // `cursor` is now the first non-off unfilled day at/below today (today
      // when today is a working day). Grace one such day (today may be empty)
      // and look at the previous day as the anchor.
      cursor = shiftLocalDate(cursor, -1);
      // Skip unfilled off days again before the anchor.
      while (off(cursor) && !filled(cursor)) cursor = shiftLocalDate(cursor, -1);
      if (!filled(cursor)) return 0;
    }
  }

  // Walk backwards from the anchor: count filled days, step over unfilled off
  // days, stop at the first unfilled working day.
  let streak = 0;
  while (true) {
    if (filled(cursor)) {
      streak += 1;
    } else if (!off(cursor)) {
      break;
    }
    cursor = shiftLocalDate(cursor, -1);
  }

  return streak;
}

/**
 * Streak milestones surfaced across the check-in UI (S9.1 "wave wow").
 *
 * Single source of truth for both the StreakCard progress strip and the
 * "palier franchi" calm celebration. Keep ascending — `crossedMilestone`
 * relies on exact equality, and `StreakCard` renders them in order.
 */
export const STREAK_MILESTONES = [7, 14, 30, 100] as const;

export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

/**
 * Pure milestone detector (S9.1). Returns the milestone the member JUST landed
 * on iff `streak` matches one EXACTLY (7 / 14 / 30 / 100), else `null`.
 *
 * Deliberately exact-match, not threshold-crossing: the celebration fires only
 * on the day the streak equals an anchor (right after that check-in), never as
 * a recurring "you're past 7" nag and never as a loss-anxiety trigger. The
 * caller already gates on "a check-in just happened".
 */
export function crossedMilestone(streak: number): StreakMilestone | null {
  return (STREAK_MILESTONES as readonly number[]).includes(streak)
    ? (streak as StreakMilestone)
    : null;
}
