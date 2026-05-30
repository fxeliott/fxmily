import 'server-only';

import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type {
  MeetingAttendanceDeclarationInput,
  MeetingAttendanceModeName,
} from '@/lib/schemas/meeting';

import { computeMeetingAttendanceRate, type MeetingAttendanceRateResult } from './attendance-rate';
import type { MeetingSlotName } from './occurrence';
import { meetingWindowStart } from './window';

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

// J-M2 — member surface `/reunions` -----------------------------------------

/**
 * Why a member cannot declare a meeting (HARD service guard, SPEC §30.7). The
 * Server Action maps each reason to a neutral FR message — `declareMeeting-
 * Attendance` REFUSES (throws) rather than silently no-op'ing.
 */
export type MeetingNotDeclarableReason = 'not_found' | 'cancelled' | 'future' | 'out_of_window';

/**
 * Thrown by {@link declareMeetingAttendance} when the target meeting is not a
 * legitimate declaration target (cancelled / future / outside the 30d window /
 * unknown). The Server Action duck-types on `name` + `reason` (so it never has
 * to import this class value — robust to module mocking in tests).
 */
export class MeetingNotDeclarableError extends Error {
  readonly reason: MeetingNotDeclarableReason;
  constructor(reason: MeetingNotDeclarableReason) {
    super(`Meeting not declarable: ${reason}`);
    this.name = 'MeetingNotDeclarableError';
    this.reason = reason;
  }
}

/** Display state of one meeting for the member (neutral, anti Black-Hat). */
export type MeetingDisplayState = 'complete' | 'partielle' | 'en_attente' | 'cancelled';

/** One meeting row as the `/reunions` page consumes it (serialised). */
export interface MemberMeetingView {
  id: string;
  slot: MeetingSlotName;
  /** Exact UTC instant of the 12h/20h Paris slot, ISO. */
  scheduledAt: string;
  status: 'scheduled' | 'cancelled';
  /**
   * `complete` = mode set AND content read · `partielle` = one of the two ·
   * `en_attente` = not declared yet (rattrapable, NEVER "absent honteux") ·
   * `cancelled` = admin cancelled (greyed, non-declarable).
   */
  displayState: MeetingDisplayState;
  /** Current declaration (for form prefill). Null until declared. */
  attendanceMode: MeetingAttendanceModeName | null;
  contentReviewed: boolean;
  /** Whether the member can (re-)declare: only past, non-cancelled, in-window. */
  declarable: boolean;
}

export interface MemberMeetingsResult {
  meetings: MemberMeetingView[];
  /** Member attendance rate over the same 30d window — neutral, honest. */
  rate: MeetingAttendanceRateResult;
}

/**
 * List the member's meetings over the rolling 30d window (past, in-window),
 * newest-first, with their per-meeting attendance state AND the honest
 * attendance rate. Both scheduled AND cancelled meetings are returned
 * (cancelled ones greyed + non-declarable in the UI), but only scheduled ones
 * feed the rate (cancelled excluded from numerator AND denominator, SPEC §30.4).
 *
 * One query (meetings + left-joined attendance for this user); the rate is
 * derived from the same rows so the list and the rate can never drift apart.
 */
export async function listMeetingsForMember(
  userId: string,
  now: Date = new Date(),
): Promise<MemberMeetingsResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { joinedAt: true } });
  // Defensive: a user that vanished mid-flight gets an empty, honest result
  // (never a fake 0%). The caller is auth-gated, so this is belt-and-suspenders.
  if (!user) {
    return { meetings: [], rate: computeMeetingAttendanceRate(0, 0) };
  }

  const fromUtc = meetingWindowStart(now, user.joinedAt);

  const rows = await db.meeting.findMany({
    where: { scheduledAt: { gte: fromUtc, lt: now } },
    orderBy: { scheduledAt: 'desc' },
    select: {
      id: true,
      slot: true,
      scheduledAt: true,
      status: true,
      attendances: {
        where: { userId },
        select: { attendanceMode: true, contentReviewed: true },
        take: 1,
      },
    },
  });

  let scheduledCount = 0;
  let completedCount = 0;

  const meetings: MemberMeetingView[] = rows.map((m) => {
    const att = m.attendances[0] ?? null;
    const attendanceMode = (att?.attendanceMode ?? null) as MeetingAttendanceModeName | null;
    const contentReviewed = att?.contentReviewed ?? false;
    const complete = attendanceMode !== null && contentReviewed === true;

    let displayState: MeetingDisplayState;
    if (m.status === 'cancelled') {
      displayState = 'cancelled';
    } else if (complete) {
      displayState = 'complete';
    } else if (attendanceMode !== null || contentReviewed) {
      displayState = 'partielle';
    } else {
      displayState = 'en_attente';
    }

    if (m.status === 'scheduled') {
      scheduledCount += 1;
      if (complete) completedCount += 1;
    }

    return {
      id: m.id,
      slot: m.slot as MeetingSlotName,
      scheduledAt: m.scheduledAt.toISOString(),
      status: m.status as 'scheduled' | 'cancelled',
      displayState,
      attendanceMode,
      contentReviewed,
      declarable: m.status === 'scheduled',
    };
  });

  return { meetings, rate: computeMeetingAttendanceRate(scheduledCount, completedCount) };
}

/** Result of a successful declaration (serialised, for the audit log / caller). */
export interface DeclaredMeetingAttendance {
  id: string;
  meetingId: string;
  attendanceMode: MeetingAttendanceModeName;
  contentReviewed: boolean;
}

/**
 * Declare (or re-declare) a member's attendance for one past meeting.
 *
 * HARD GUARD (SPEC §30.7) — the declaration is REFUSED (throws
 * {@link MeetingNotDeclarableError}) when the meeting is:
 *   - unknown (`not_found`),
 *   - cancelled (`cancelled`) — a member is never credited for a slot Eliot
 *     didn't run, and never penalised either,
 *   - in the future (`future`, `scheduledAt > now`),
 *   - outside the rolling 30d window (`out_of_window`,
 *     `scheduledAt < meetingWindowStart(now, joinedAt)`).
 *
 * Otherwise it upserts on the `(meetingId, userId)` unique key — re-declaring
 * UPDATES the same row (never stacks), bumping `declaredAt` (latest engagement).
 */
export async function declareMeetingAttendance(
  userId: string,
  input: MeetingAttendanceDeclarationInput,
  now: Date = new Date(),
): Promise<DeclaredMeetingAttendance> {
  const [meeting, user] = await Promise.all([
    db.meeting.findUnique({
      where: { id: input.meetingId },
      select: { id: true, status: true, scheduledAt: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { joinedAt: true } }),
  ]);

  // `not_found` covers both a missing meeting and a user that vanished
  // mid-flight (cannot resolve the window without `joinedAt`).
  if (!meeting || !user) throw new MeetingNotDeclarableError('not_found');
  if (meeting.status === 'cancelled') throw new MeetingNotDeclarableError('cancelled');
  if (meeting.scheduledAt.getTime() > now.getTime()) {
    throw new MeetingNotDeclarableError('future');
  }
  const fromUtc = meetingWindowStart(now, user.joinedAt);
  if (meeting.scheduledAt.getTime() < fromUtc.getTime()) {
    throw new MeetingNotDeclarableError('out_of_window');
  }

  const row = await db.meetingAttendance.upsert({
    where: { meetingId_userId: { meetingId: input.meetingId, userId } },
    create: {
      meetingId: input.meetingId,
      userId,
      attendanceMode: input.attendanceMode,
      contentReviewed: input.contentReviewed,
      declaredAt: now,
    },
    update: {
      attendanceMode: input.attendanceMode,
      contentReviewed: input.contentReviewed,
      declaredAt: now,
    },
    select: { id: true, meetingId: true, attendanceMode: true, contentReviewed: true },
  });

  return {
    id: row.id,
    meetingId: row.meetingId,
    attendanceMode: row.attendanceMode as MeetingAttendanceModeName,
    contentReviewed: row.contentReviewed,
  };
}
