/**
 * V1.7 §30 — Meeting attendance rolling window (J-M1 data layer, pure module).
 *
 * One single window bound (SPEC §30.7 invariant) drives, simultaneously:
 *   - the declaration cutoff (a member can only declare a meeting inside it),
 *   - the attendance-rate denominator,
 *   - the engagement sub-score input window (J-M4).
 *
 * Pure: no DB, no `Date.now()`, no `import 'server-only'`. The caller injects
 * `now` (deterministic tests, mirrors every scoring/trigger fn in the repo).
 */

import { localDateOf, localInstantToUtc } from '@/lib/checkin/timezone';

import { MEETING_TIMEZONE } from './occurrence';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rolling window length. 30 days = the rattrapage budget Eliot set (members
 * are expected to catch up on replays, but a 3-month bulk catch-up would
 * distort the effort/regularity signal — SPEC §30.2 T1-3). The SAME bound is
 * reused everywhere (declaration + rate + engagement) for strict coherence.
 */
export const MEETING_WINDOW_DAYS = 30;

/**
 * Start of the attendance window for a member, as a UTC instant:
 *   `max(now − MEETING_WINDOW_DAYS, startOfDay(joinedAt, Europe/Paris))`
 *
 * The `max` natively handles a member who joined mid-period (T3-1): their
 * denominator never counts meetings held before they existed. `startOfDay`
 * snaps to Paris-local midnight so a member who joined at 14h still gets full
 * credit for that day's meetings.
 *
 * The window is half-open `[start, now)` at the query layer — see
 * `countMeetingAttendance` (only past meetings count for the denominator).
 */
export function meetingWindowStart(now: Date, joinedAt: Date): Date {
  const windowFloor = new Date(now.getTime() - MEETING_WINDOW_DAYS * MS_PER_DAY);
  const joinFloor = startOfDayParis(joinedAt);
  // `max`: whichever bound is the more recent (later) instant.
  return joinFloor.getTime() > windowFloor.getTime() ? joinFloor : windowFloor;
}

/** UTC instant of Paris-local midnight on the civil day containing `instant`. */
function startOfDayParis(instant: Date): Date {
  return localInstantToUtc(localDateOf(instant, MEETING_TIMEZONE), 0, 0, 0, 0, MEETING_TIMEZONE);
}
