/**
 * Fair-indexing (new-member) — the engagement fill-rate window floor.
 *
 * Pure module (no DB, no `Date.now()`, no `server-only`), the scoring analogue
 * of `@/lib/meeting/window`'s `floorMeetingWindowAtJoin`. It answers ONE
 * question: where does a member's assiduité fill-rate denominator start?
 *
 * The engagement `checkinFillRate` is `daysWithAny / windowDays` (a 30-day
 * rolling denominator). For a member who registered mid-window, charging the
 * FULL 30 days is structurally unfair: someone who joined 10 days ago and
 * checked in 9 of those 10 days shows `9 / 30 ≈ 30 %` assiduité instead of the
 * true `9 / 10 = 90 %`. That single distortion is what stops a diligent newcomer
 * from ever climbing the leaderboard — assiduité is exactly the lever they own
 * from day one, and it was being silently crushed. Flooring the denominator at
 * the join day mirrors how a justified off-day already drops out of it (Tour
 * 14): the member is measured on the days they actually existed.
 *
 * Veterans are unaffected: anyone who joined on or before the window start keeps
 * the full window (byte-identical), so this is a pure addition that only ever
 * helps members inside their first 30 days.
 */

import type { LocalDateString } from '@/lib/checkin/timezone';

/**
 * Floor the fill-rate window start at the member's join day.
 *
 * `windowStart` and `joinLocalDay` are civil-local `YYYY-MM-DD` strings, so
 * lexicographic order IS chronological order — no parsing needed. Returns the
 * LATER of the two bounds (the join day only when it falls strictly inside the
 * window). A `null` join day (single-user caller that never resolved it) leaves
 * the window untouched, byte-identical to the pre-fix behaviour.
 */
export function floorFillWindowStart(
  windowStart: LocalDateString,
  joinLocalDay: LocalDateString | null,
): LocalDateString {
  return joinLocalDay !== null && joinLocalDay > windowStart ? joinLocalDay : windowStart;
}
