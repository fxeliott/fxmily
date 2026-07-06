/**
 * Tour 15 — onboarding "ramp-up" window for behavioral scores.
 *
 * A member who joined less than {@link RAMP_UP_DAYS} ago is still building their
 * track record: a low score in that window is not a failure, it is a base under
 * construction. The score gauge FLOORS a red "Critique" band to a calm "En
 * rodage" while this predicate is true (SPEC §2 / §31.2 — never punitive, and
 * never faked: the numeric score itself is untouched, only its framing).
 *
 * Pure + framework-free so both the server (which knows `joinedAt`) and unit
 * tests can consume it without a DB or a clock. The gauge component re-exports
 * {@link RAMP_UP_DAYS} for its own copy.
 */

/** Days after joining during which a low score reads "En rodage", not "Critique". */
export const RAMP_UP_DAYS = 30;

/**
 * True iff `joinedAt` is within the last {@link RAMP_UP_DAYS} days at `now`.
 *
 * Boundary: exactly `RAMP_UP_DAYS` days elapsed is NO LONGER ramp-up (the member
 * has completed the base window). A future `joinedAt` (clock skew) is treated as
 * ramp-up — a brand-new member is the whole point, never penalise the edge.
 * Millisecond arithmetic on absolute instants — no timezone needed (the window
 * is a 30-day duration, not a calendar-day count).
 */
export function isMemberInRampUp(joinedAt: Date, now: Date = new Date()): boolean {
  const elapsedMs = now.getTime() - joinedAt.getTime();
  if (elapsedMs < 0) return true; // joined "in the future" (skew) → treat as new
  return elapsedMs < RAMP_UP_DAYS * 24 * 60 * 60 * 1000;
}
