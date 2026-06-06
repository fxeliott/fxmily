import 'server-only';

import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';

/**
 * V1.7 §30 — Meeting attendance service (J-M1 data layer).
 *
 * The ONLY DB-aware surface of the meeting feature at J-M1. Exposes the
 * count-only primitive that feeds the attendance rate (member + admin display,
 * J-M2/J-M3) and the engagement sub-score (J-M4, ADDITION PURE via
 * `rateSubScore(completedCount, scheduledCount, WEIGHT_MEETING)`).
 *
 * Carbon copy of `countRecentTrainingActivity` (`training-trade-service.ts`):
 * a narrow count-only primitive, parallel queries, window injected by the
 * caller (deterministic + tz-agnostic). Unlike training, the meeting feature
 * intentionally DOES feed engagement — there is no §21.5 isolation here.
 */

export interface MeetingAttendanceCounts {
  /**
   * Scheduled (non-cancelled) meetings whose `scheduledAt` falls in the
   * half-open window `[fromUtc, toUtc)` = the attendance-rate DENOMINATOR.
   * Cancelled meetings are excluded (a member is never penalised for a slot
   * Eliot did not run — SPEC §30.2).
   */
  scheduledCount: number;
  /**
   * The member's COMPLETE attendances (`attendanceMode != null` AND
   * `contentReviewed = true`) for those same scheduled, in-window meetings =
   * the NUMERATOR. An attendance whose meeting was cancelled after the fact is
   * excluded by the `meeting.status = 'scheduled'` join filter (SPEC §30.4:
   * the row is kept but excluded, never deleted).
   */
  completedCount: number;
  /**
   * All-time most-recent declaration timestamp (ISO), window-independent — a
   * "last activity" recency signal for the member view (mirror of training's
   * `lastEnteredAt`). It is NOT filtered by window or `status`, so it can point
   * at a declaration on a later-cancelled or out-of-window meeting. That is
   * intentional for a recency cue, but it must NEVER feed a score: the J-M4
   * engagement sub-score is keyed on `scheduledCount`/`completedCount` only.
   * Null if the member never declared.
   */
  lastDeclaredAt: string | null;
}

/**
 * Count a member's scheduled meetings + complete attendances over the half-open
 * window `[fromUtc, toUtc)`, plus the all-time last declaration timestamp.
 *
 * The window is half-open: `gte: fromUtc` (a meeting exactly at the window
 * start counts) and `lt: toUtc` (a meeting exactly at `toUtc` does not — the
 * caller passes `toUtc = now`, and the denominator is "past meetings only",
 * `scheduledAt < now`, SPEC §30.3). The caller derives `fromUtc` via
 * `meetingWindowStart(now, joinedAt)` so a member who joined mid-period is
 * handled natively.
 *
 * Three parallel queries, count-only (no P&L, no meeting bodies) — the rate is
 * computed by the pure `computeMeetingAttendanceRate` from the two counts.
 */
export async function countMeetingAttendance(
  userId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<MeetingAttendanceCounts> {
  // Shared filter: scheduled (non-cancelled) meetings in the half-open window.
  // Reused for BOTH the denominator (direct) and the numerator (relation
  // filter) so the two counts can never drift apart (SPEC §30.4 coherence).
  const inScheduledWindow: Prisma.MeetingWhereInput = {
    status: 'scheduled',
    scheduledAt: { gte: fromUtc, lt: toUtc },
  };

  const [scheduledCount, completedCount, last] = await Promise.all([
    db.meeting.count({ where: inScheduledWindow }),
    db.meetingAttendance.count({
      where: {
        userId,
        attendanceMode: { not: null },
        contentReviewed: true,
        meeting: inScheduledWindow,
      },
    }),
    db.meetingAttendance.findFirst({
      where: { userId },
      orderBy: { declaredAt: 'desc' },
      select: { declaredAt: true },
    }),
  ]);

  return {
    scheduledCount,
    completedCount,
    lastDeclaredAt: last ? last.declaredAt.toISOString() : null,
  };
}
