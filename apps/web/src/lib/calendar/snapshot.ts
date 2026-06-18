/**
 * §26 Calendrier adaptatif — PURE snapshot builder (J-C1).
 *
 * ISOLATION (§2 / §21.5 / §27.7 — BLOQUANT). This module is the firewall
 * between the member's real edge and the Claude calendar prompt:
 *
 *   - It is PURE: no DB, no env, no `Date.now()`, no `import 'server-only'`.
 *     The DB-side count-only reads live in `lib/calendar/service.ts`; this
 *     module only ASSEMBLES the snapshot from already-counted inputs, so it is
 *     directly importable by the anti-leak test
 *     (test/anti-leak/calendar-isolation.test.ts).
 *   - `CalendarActivityCounts` carries ONLY activity COUNTERS. It is
 *     structurally impossible to add a P&L field (`realizedR` / `outcome` /
 *     `plannedRR` / `resultR`) to the snapshot without editing this type — and
 *     the anti-leak test pins that. Claude is told WHEN the member is active,
 *     never WHETHER they win or lose. Posture §2: the calendar organises TIME.
 *   - A meeting-attendance counter (`meetingsAttendedLast4w`) is intentionally
 *     ABSENT. NOTE (S6 pass-3): the §30 réunions models (`Meeting` /
 *     `MeetingAttendance`) ARE on `main` and LIVE in prod — the count-only
 *     `countMeetingAttendance` primitive already feeds the weekly/monthly
 *     loaders + daily-guidance. Wiring a past-attendance signal into THIS
 *     calendar snapshot (so Claude can size the week against the member's real
 *     meeting rhythm) is a deliberate §30-enrichment DECISION still pending
 *     (`meetingsAttendedLast4w` via the same primitive — additive, §2-safe,
 *     no schema change). The questionnaire today captures only the FORWARD
 *     intent (`meeting_commitment`), not past assiduité.
 */

import type { WeeklyScheduleResponses } from '@/lib/schemas/weekly-schedule-questionnaire';
import { safeFreeText } from '@/lib/text/safe';

/**
 * Count-only activity signals sent to Claude. NEVER a P&L field. Every number
 * is "how often / how recently the member practised", never "how they did".
 */
export interface CalendarActivityCounts {
  /** Real-edge trades with `enteredAt` in the last 30 days (count, no result). */
  readonly tradesLast30d: number;
  /** Daily check-ins logged in the last 14 days (count). */
  readonly checkinsLast14d: number;
  /** Backtest/training sessions in the last 14 days — count-only §21.5 primitive. */
  readonly trainingSessionsLast14d: number;
  /** Most recent mindset check date (YYYY-MM-DD), or null if never. */
  readonly lastMindsetCheckDate: string | null;
}

/**
 * Everything the pure builder needs. `profileSummary` is the member's onboarding
 * profile text (psychology/process, posture §2) — the ONLY free-text reaching
 * Claude. The builder strips bidi/zero-width control chars via `safeFreeText`
 * (defense-in-depth at the snapshot boundary — the J-C2 prompt builder ALSO
 * wraps it in `wrapUntrustedMemberInput`; neither defense relies on the other).
 */
export interface CalendarSnapshotInput {
  readonly pseudonymLabel: string;
  /** Monday of the planned week, YYYY-MM-DD local Europe/Paris. */
  readonly weekStart: string;
  readonly instrumentVersion: number;
  readonly profileSummary: string | null;
  readonly responses: WeeklyScheduleResponses;
  readonly activity: CalendarActivityCounts;
}

/** What travels to Claude. No userId, no P&L — pseudonymised + count-only. */
export interface CalendarSnapshot {
  readonly pseudonymLabel: string;
  readonly weekStart: string;
  readonly instrumentVersion: number;
  readonly profileSummary: string | null;
  readonly responses: WeeklyScheduleResponses;
  readonly activity: CalendarActivityCounts;
  /** Derived: total available slots across the week (helps Claude size it). */
  readonly availableSlotsCount: number;
}

function countTrueSlots(
  grid: Record<string, { morning: boolean; afternoon: boolean; evening: boolean }>,
): number {
  let total = 0;
  for (const day of Object.values(grid)) {
    if (day.morning) total += 1;
    if (day.afternoon) total += 1;
    if (day.evening) total += 1;
  }
  return total;
}

/**
 * Assemble the count-only snapshot. Pure: same input → same output, no I/O.
 * The returned object is what the J-C2 prompt builder renders for Claude.
 */
export function buildCalendarSnapshot(input: CalendarSnapshotInput): CalendarSnapshot {
  const availableSlotsCount =
    countTrueSlots(input.responses.weekdayAvailability) +
    countTrueSlots(input.responses.weekendAvailability);

  return {
    pseudonymLabel: input.pseudonymLabel,
    weekStart: input.weekStart,
    instrumentVersion: input.instrumentVersion,
    // Defense-in-depth: strip NFC/bidi/zero-width even though `summary` is
    // already model-generated — a Trojan-Source RTL override must never ride
    // into the J-C2 Claude prompt (belt-and-suspenders with the XML wrap).
    profileSummary: input.profileSummary === null ? null : safeFreeText(input.profileSummary),
    responses: input.responses,
    activity: input.activity,
    availableSlotsCount,
  };
}
