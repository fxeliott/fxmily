/**
 * V2 S2 — Pure cadence helpers for the recurring tracking engine.
 *
 * PURE functions ONLY (no DB, no `server-only`, no ambient clock — every helper
 * takes its `now`/`localDate` explicitly so the logic is deterministically
 * unit-testable without Postgres, CI-safe). Dates are handled via the shared
 * `lib/checkin/timezone` helpers (UTC-midnight pin, anti-DST-drift invariant
 * PR#96) so `occurrenceKey` never drifts a calendar day across timezones.
 *
 * The engine's goal (DoD case 4): spread captures over time, NEVER pile them up.
 * Cadence drives both the idempotency key (one entry per occurrence) and the
 * next due time the calm guidance surface reads (SPEC §2: no streak/urgency).
 */

import { localDateOf, shiftLocalDate } from '@/lib/checkin/timezone';

import type { TrackingCadence } from './types';

/** ISO-week number of a local `YYYY-MM-DD` date (ISO-8601, week starts Monday). */
function isoWeekOf(localDate: string): { year: number; week: number } {
  const parts = localDate.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  // Work in UTC to avoid any local-tz interference (date is already local-pinned).
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  // Shift to the Thursday of this week (ISO anchor), then count weeks from Jan 1.
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/**
 * Canonical occurrence key for a capture, given the cadence and the moment.
 *   - daily   → "YYYY-MM-DD" (local day)
 *   - weekly  → "GGGG-Www"   (ISO year-week, e.g. "2026-W26")
 *   - per_trade / manual → REQUIRES an explicit `nonce` (trade id, manual ts);
 *     throws if missing so a caller can never silently collide two events.
 */
export function computeOccurrenceKey(
  cadence: TrackingCadence,
  now: Date,
  timezone: string,
  nonce?: string,
): string {
  switch (cadence.kind) {
    case 'daily':
      return localDateOf(now, timezone);
    case 'weekly': {
      const { year, week } = isoWeekOf(localDateOf(now, timezone));
      return `${year}-W${String(week).padStart(2, '0')}`;
    }
    case 'per_trade':
    case 'manual':
      if (!nonce || nonce.length === 0) {
        throw new Error(`occurrenceKey: cadence "${cadence.kind}" requires a nonce`);
      }
      return nonce;
  }
}

/**
 * Compute the next due `Date` (UTC-midnight of a local day) AFTER a completion.
 *   - daily   → tomorrow (local).
 *   - weekly  → the next occurrence of `anchorDow` strictly after today (local).
 *   - per_trade / manual → `null` (event-/member-driven, no schedule sweep).
 *
 * Returned as the UTC-midnight `Date` of the target local day (matches the
 * `parseLocalDate` convention used elsewhere), so DB `DateTime` storage is
 * timezone-stable.
 */
export function computeNextDueAt(
  cadence: TrackingCadence,
  completedAt: Date,
  timezone: string,
): Date | null {
  const today = localDateOf(completedAt, timezone);
  switch (cadence.kind) {
    case 'daily':
      return localDateToUtcMidnight(shiftLocalDate(today, 1));
    case 'weekly': {
      const parts = today.split('-');
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const d = Number(parts[2]);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0 … Sat=6
      // Days until the next anchor, strictly in the future (1..7).
      let delta = (cadence.anchorDow - dow + 7) % 7;
      if (delta === 0) delta = 7;
      return localDateToUtcMidnight(shiftLocalDate(today, delta));
    }
    case 'per_trade':
    case 'manual':
      return null;
  }
}

/** UTC-midnight `Date` of a local `YYYY-MM-DD` (no `parseLocalDate` import cycle). */
function localDateToUtcMidnight(localDate: string): Date {
  const parts = localDate.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(Date.UTC(y, m - 1, d));
}

export interface ScheduleState {
  readonly nextDueAt: Date;
  readonly pausedUntil: Date | null;
}

/**
 * Is this instrument due to be surfaced to the member at `now`? Due iff it is
 * past `nextDueAt` AND not currently snoozed (`pausedUntil` in the future).
 */
export function isDue(schedule: ScheduleState, now: Date): boolean {
  if (schedule.pausedUntil && schedule.pausedUntil.getTime() > now.getTime()) {
    return false;
  }
  return now.getTime() >= schedule.nextDueAt.getTime();
}
