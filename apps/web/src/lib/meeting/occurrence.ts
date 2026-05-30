/**
 * V1.7 §30 — Meeting occurrence generation (J-M1 data layer, pure module).
 *
 * Builds the recurring Fxmily meeting occurrences (Mon–Fri 12h & 20h
 * Europe/Paris) that the J-M3 cron materialises into `Meeting` rows. Kept a
 * PURE module (carbon copy of the `pre-trade/analytics.ts` discipline) :
 *   - No DB access (Prisma is the cron's concern).
 *   - No `Date.now()` (the cron injects the anchor date).
 *   - No `import 'server-only'` → loadable from any runtime (Vitest + a future
 *     Playwright E2E can import it directly without the alias-shim trick from
 *     Session GG scar GG-CI).
 *
 * DST correctness (invariant SPEC §30.7) : `scheduledAt` is the exact UTC
 * instant of the 12h/20h Paris slot, computed via the real `localInstantToUtc`
 * helper (CET = 11h UTC / CEST = 10h UTC). The civil `date` is then DERIVED
 * from `scheduledAt` by construction (`localDateOf`), never computed
 * independently — so the two can never diverge on a DST switch day.
 */

import {
  localDateOf,
  localInstantToUtc,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';

/** Single source of truth for the meeting timezone (V1 cohort = France). */
export const MEETING_TIMEZONE = 'Europe/Paris';

/** The two daily slots. `as const` so the values are reusable + assertable. */
export const MEETING_SLOTS = ['midday', 'evening'] as const;
export type MeetingSlotName = (typeof MEETING_SLOTS)[number];

/** Wall-clock hour (Europe/Paris) of each slot — verbatim Eliot "12h et 20h". */
const SLOT_HOUR: Record<MeetingSlotName, number> = {
  midday: 12,
  evening: 20,
};

/** A single meeting occurrence: the civil day + slot + its exact UTC instant. */
export interface MeetingOccurrence {
  /** Civil day Europe/Paris, YYYY-MM-DD. DERIVED from `scheduledAt`. */
  date: LocalDateString;
  slot: MeetingSlotName;
  /** Exact UTC instant of the slot's 12h/20h Paris wall-clock time. */
  scheduledAt: Date;
}

/**
 * Build the occurrence for one (localDate, slot). The invariant §30.7 order is
 * enforced here: compute `scheduledAt` FIRST (DST-aware), THEN derive `date`
 * from it. Both 12h and 20h are mid-day wall-clock times, so `date` always
 * equals the input `localDate` — but we derive it from `scheduledAt` anyway so
 * the cron has exactly ONE source of truth (round-trip pinned by tests).
 */
export function buildMeetingOccurrence(
  localDate: LocalDateString,
  slot: MeetingSlotName,
): MeetingOccurrence {
  const scheduledAt = localInstantToUtc(localDate, SLOT_HOUR[slot], 0, 0, 0, MEETING_TIMEZONE);
  const date = localDateOf(scheduledAt, MEETING_TIMEZONE);
  return { date, slot, scheduledAt };
}

/** ISO weekday is irrelevant here — Sat (6) / Sun (0) via JS `getUTCDay()`. */
function isWeekend(localDate: LocalDateString): boolean {
  const dow = parseLocalDate(localDate).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Generate every Mon–Fri 12h/20h occurrence in the rolling window
 * `[fromLocalDate, fromLocalDate + days)` (calendar days, `from` inclusive).
 * Weekends are skipped. For each weekday, BOTH slots are emitted in
 * chronological order (midday then evening).
 *
 * Deterministic + side-effect-free: calling it twice with the same arguments
 * yields byte-identical occurrences. The DB-level idempotence (re-run = 0
 * duplicate) is the cron's `@@unique(date, slot)` upsert job (J-M3); this
 * pure function guarantees the *inputs* to that upsert are stable.
 *
 * @param fromLocalDate first civil day (Europe/Paris) to scan, inclusive.
 * @param days number of calendar days to scan (clamped to `>= 0`).
 */
export function generateMeetingOccurrences(
  fromLocalDate: LocalDateString,
  days: number,
): MeetingOccurrence[] {
  const span = Math.max(0, Math.trunc(days));
  const occurrences: MeetingOccurrence[] = [];
  for (let offset = 0; offset < span; offset += 1) {
    const localDate = shiftLocalDate(fromLocalDate, offset);
    if (isWeekend(localDate)) continue;
    for (const slot of MEETING_SLOTS) {
      occurrences.push(buildMeetingOccurrence(localDate, slot));
    }
  }
  return occurrences;
}
