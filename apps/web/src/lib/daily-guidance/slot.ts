/**
 * Session 5 — Guidage quotidien : pure day-slot derivation (no DB, no env, no
 * `server-only`). Imported by the daily-guidance service AND the unit test.
 *
 * Mirrors the anti-flake invariant of `lib/calendar/week.ts` / `lib/checkin/
 * timezone.ts` : the wall-clock hour is read in the member's IANA timezone via
 * `Intl.DateTimeFormat`, NEVER via `Date.getHours()` on a naive instant. The 3
 * buckets mirror the `CalendarSlot` enum (morning / afternoon / evening) so the
 * "now" slot maps 1:1 onto the calendar block slots it surfaces.
 *
 * Posture §2 / anti-Black-Hat : this is purely a TIME bucket — it carries no
 * urgency, no deadline, no score. It only decides which calm action to put
 * first ("au bon moment", DoD §30 #3).
 */

export type DaySlot = 'morning' | 'afternoon' | 'evening';

/** Slot boundaries (Europe/Paris wall-clock hours). morning < 12 ≤ afternoon < 18 ≤ evening. */
const AFTERNOON_FROM_HOUR = 12;
const EVENING_FROM_HOUR = 18;

/**
 * Wall-clock hour (0-23) in the given IANA timezone for `instant`. Falls back
 * to UTC on an unknown timezone (defensive, carbone `localDateOf`). en-GB
 * renders midnight as `00`, never `24`.
 */
export function localHour(instant: Date, timezone: string): number {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
  const hourStr = fmt.formatToParts(instant).find((p) => p.type === 'hour')?.value ?? '00';
  const h = Number(hourStr);
  return h === 24 ? 0 : h;
}

/** The current day-slot for `instant` in the member's timezone. */
export function currentDaySlot(instant: Date, timezone: string): DaySlot {
  const h = localHour(instant, timezone);
  if (h < AFTERNOON_FROM_HOUR) return 'morning';
  if (h < EVENING_FROM_HOUR) return 'afternoon';
  return 'evening';
}

/**
 * Which daily check-in is the "now" focus.
 *   - morning + afternoon  → the MORNING check-in is the primary nudge (sleep /
 *     routine / market-prep, filled early). The evening one is secondary.
 *   - evening              → the EVENING check-in is primary (discipline / stress
 *     debrief). The morning one is shown as a (calm) catch-up.
 *
 * Pure mapping — the caller pairs it with the submitted booleans to decide the
 * `todo`/`done` state. No urgency, mirror of `REMINDER_WINDOWS` intent.
 */
export function primaryCheckinSlot(slot: DaySlot): 'morning' | 'evening' {
  return slot === 'evening' ? 'evening' : 'morning';
}

export const DAY_SLOT_LABELS: Record<DaySlot, string> = {
  morning: 'Matinée',
  afternoon: 'Après-midi',
  evening: 'Soirée',
};
