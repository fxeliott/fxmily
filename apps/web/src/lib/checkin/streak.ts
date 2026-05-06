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
 * @param days   Pre-fetched check-in rows. Order doesn't matter; duplicates
 *               are tolerated (we collapse to a Set of dates internally).
 * @param today  The "today" anchor in the user's local TZ (YYYY-MM-DD). Use
 *               `localDateOf(new Date(), user.timezone)` upstream.
 */
export function computeStreak(days: readonly CheckinDay[], today: LocalDateString): number {
  if (days.length === 0) return 0;

  // Collapse to a Set of dates with ≥1 check-in. Future-dated rows (clock skew)
  // are filtered out: they shouldn't influence today's streak.
  const filledDates = new Set<LocalDateString>();
  for (const d of days) {
    if (d.slots.length > 0 && d.date <= today) filledDates.add(d.date);
  }

  if (filledDates.size === 0) return 0;

  let cursor: LocalDateString;
  let streak = 0;

  if (filledDates.has(today)) {
    // Today is filled — start counting from today.
    cursor = today;
  } else {
    // Today is empty — the streak is the run of consecutive days ending
    // *yesterday*. If yesterday is also empty, streak is 0.
    const yesterday = shiftLocalDate(today, -1);
    if (!filledDates.has(yesterday)) return 0;
    cursor = yesterday;
  }

  while (filledDates.has(cursor)) {
    streak += 1;
    cursor = shiftLocalDate(cursor, -1);
  }

  return streak;
}
