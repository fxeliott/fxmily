import 'server-only';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type {
  MeetingAttendanceDeclarationInput,
  MeetingAttendanceModeName,
} from '@/lib/schemas/meeting';
import { safeFreeText } from '@/lib/text/safe';

import { computeMeetingAttendanceRate, type MeetingAttendanceRateResult } from './attendance-rate';
import { generateMeetingOccurrences, type MeetingSlotName } from './occurrence';
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

// Session 5 (guidage quotidien) — "réunion aujourd'hui" ----------------------

/** One scheduled meeting on a given civil day, for the daily-guidance panel. */
export interface TodayMeetingView {
  id: string;
  slot: MeetingSlotName;
  /** Exact UTC instant of the 12h/20h Paris slot, ISO. */
  scheduledAt: string;
}

/**
 * List the SCHEDULED (non-cancelled) meetings whose civil day (Europe/Paris,
 * `@db.Date`) equals `localDate` (YYYY-MM-DD), ordered by slot time. Read-only,
 * platform-wide (meetings are admin-generated, not per-member) — used by the
 * "Ton aujourd'hui" guidance to surface "réunion aujourd'hui à 12h / 20h"
 * without any P&L or attendance content (posture §2). Cancelled slots are
 * excluded (a member is never nudged toward a slot Eliot did not run). Hits the
 * `@@unique([date, slot])` index directly.
 */
export async function listScheduledMeetingsOn(localDate: string): Promise<TodayMeetingView[]> {
  const rows = await db.meeting.findMany({
    where: { date: parseLocalDate(localDate), status: 'scheduled' },
    orderBy: { scheduledAt: 'asc' },
    select: { id: true, slot: true, scheduledAt: true },
  });
  return rows.map((m) => ({
    id: m.id,
    slot: m.slot as MeetingSlotName,
    scheduledAt: m.scheduledAt.toISOString(),
  }));
}

// J-M3 — admin surface + cron generation ------------------------------------

/** Counts returned by the idempotent generation pass (cron heartbeat). */
export interface GenerateMeetingsResult {
  /** New `Meeting` rows actually inserted on this run. */
  generated: number;
  /** Occurrences that already existed (idempotent skip on `@@unique(date, slot)`). */
  skipped: number;
}

/**
 * Materialise every Mon–Fri 12h/20h occurrence in the rolling window
 * `[fromLocalDate, fromLocalDate + days)` into `Meeting` rows, idempotently.
 *
 * The pure {@link generateMeetingOccurrences} supplies the deterministic,
 * DST-aware `(date, slot, scheduledAt)` triples (weekends skipped); this fn is
 * the ONLY DB-aware step. Idempotence is enforced by `createMany({ skipDuplicates:
 * true })` on the `@@unique(date, slot)` key — a second run within the same
 * window inserts 0 duplicates (SPEC §30.7), so `generated + skipped` always
 * equals the occurrence count.
 *
 * Invariant §30.7: `date` is DERIVED from `scheduledAt` upstream (the occurrence
 * builder), never recomputed here — we persist the occurrence's `date` via
 * `parseLocalDate` (UTC-midnight for the `@db.Date` column, canon DailyCheckin)
 * and its `scheduledAt` verbatim. `status` defaults to `scheduled`; a freshly
 * generated slot is never created `cancelled`.
 */
export async function generateMeetingsForWindow(
  fromLocalDate: string,
  days: number,
): Promise<GenerateMeetingsResult> {
  const occurrences = generateMeetingOccurrences(fromLocalDate, days);
  if (occurrences.length === 0) return { generated: 0, skipped: 0 };

  const result = await db.meeting.createMany({
    data: occurrences.map((o) => ({
      // `@db.Date` wants a UTC-midnight Date — `parseLocalDate` pins it without
      // tz drift. `o.date` is itself `localDateOf(o.scheduledAt)` (derivation,
      // §30.7), so the two columns can never diverge on a DST switch day.
      date: parseLocalDate(o.date),
      slot: o.slot,
      scheduledAt: o.scheduledAt,
    })),
    // Idempotent re-run: the `@@unique(date, slot)` key skips existing rows.
    skipDuplicates: true,
  });

  return { generated: result.count, skipped: occurrences.length - result.count };
}

/**
 * Thrown by {@link cancelMeeting} / {@link uncancelMeeting} when the target
 * meeting id does not resolve. The admin Server Action duck-types on `name`
 * (robust to module mocking in tests), mirror of {@link MeetingNotDeclarableError}.
 */
export class MeetingNotFoundError extends Error {
  constructor(readonly meetingId: string) {
    super(`Meeting not found: ${meetingId}`);
    this.name = 'MeetingNotFoundError';
  }
}

/** Result of a cancel/uncancel mutation (serialised, for the caller/audit). */
export interface CancelledMeeting {
  id: string;
  status: 'scheduled' | 'cancelled';
}

/**
 * Cancel a meeting slot ("pas dispo / pas de réunion", SPEC §30.2). Flips
 * `status` to `cancelled` and stores an optional admin note (`safeFreeText`-
 * sanitised — NFC + bidi/zero-width stripping, SPEC §30.6). A cancelled slot is
 * excluded from EVERY member's rate denominator (the count/list queries filter
 * `status='scheduled'`), so a member is never penalised when Eliot is away.
 *
 * Cancellation NEVER cascades to `MeetingAttendance` (SPEC §30.4/§30.7): a row a
 * member declared in good faith before the cancellation is kept (audit trace),
 * greyed + excluded — never deleted. Throws {@link MeetingNotFoundError} on an
 * unknown id (fail-loud rather than an opaque Prisma `P2025`).
 */
export async function cancelMeeting(meetingId: string, reason?: string): Promise<CancelledMeeting> {
  const existing = await db.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true },
  });
  if (!existing) throw new MeetingNotFoundError(meetingId);

  const row = await db.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'cancelled',
      cancelledReason: reason ? safeFreeText(reason) : null,
    },
    select: { id: true, status: true },
  });
  return { id: row.id, status: row.status as 'scheduled' | 'cancelled' };
}

/**
 * Un-cancel a meeting slot — back to `scheduled`, clears the reason. The slot
 * re-enters every member's denominator. Throws {@link MeetingNotFoundError} on
 * an unknown id.
 */
export async function uncancelMeeting(meetingId: string): Promise<CancelledMeeting> {
  const existing = await db.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true },
  });
  if (!existing) throw new MeetingNotFoundError(meetingId);

  const row = await db.meeting.update({
    where: { id: meetingId },
    data: { status: 'scheduled', cancelledReason: null },
    select: { id: true, status: true },
  });
  return { id: row.id, status: row.status as 'scheduled' | 'cancelled' };
}

/** Number of days of recent + upcoming meetings the `/admin/reunions` list shows. */
export const ADMIN_MEETING_WINDOW_DAYS = 14;

/** One meeting row as the `/admin/reunions` list consumes it (serialised). */
export interface AdminMeetingView {
  id: string;
  slot: MeetingSlotName;
  /** Exact UTC instant of the 12h/20h Paris slot, ISO. */
  scheduledAt: string;
  status: 'scheduled' | 'cancelled';
  /** Past relative to the query `now` (UI distinguishes recent vs upcoming). */
  isPast: boolean;
  /** Number of COMPLETE attendances on this slot (numerator-style, neutral). */
  completedCount: number;
  /** Total members who declared SOMETHING (complete or partial) on this slot. */
  declaredCount: number;
}

/**
 * List recent + upcoming meetings (a window centred on `now`) with their
 * per-meeting attendance counts, for the `/admin/reunions` admin list.
 *
 * Read-only, admin-scoped. BOTH scheduled and cancelled slots are returned (a
 * cancelled slot is greyed in the UI + carries a cancel/uncancel control), but
 * the counts are purely informational — they never feed a rate here (the per-
 * member rate lives in {@link listMeetingAttendanceForMember}). PII-free: counts
 * only, no member identity, no Ichor content (posture §2).
 */
export async function listMeetingsForAdmin(now: Date = new Date()): Promise<AdminMeetingView[]> {
  const fromUtc = new Date(now.getTime() - ADMIN_MEETING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const toUtc = new Date(now.getTime() + ADMIN_MEETING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db.meeting.findMany({
    where: { scheduledAt: { gte: fromUtc, lt: toUtc } },
    orderBy: { scheduledAt: 'desc' },
    select: {
      id: true,
      slot: true,
      scheduledAt: true,
      status: true,
      attendances: {
        select: { attendanceMode: true, contentReviewed: true },
      },
    },
  });

  return rows.map((m) => {
    let completedCount = 0;
    let declaredCount = 0;
    for (const a of m.attendances) {
      const declaredSomething = a.attendanceMode !== null || a.contentReviewed;
      if (declaredSomething) declaredCount += 1;
      if (a.attendanceMode !== null && a.contentReviewed === true) completedCount += 1;
    }
    return {
      id: m.id,
      slot: m.slot as MeetingSlotName,
      scheduledAt: m.scheduledAt.toISOString(),
      status: m.status as 'scheduled' | 'cancelled',
      isPast: m.scheduledAt.getTime() < now.getTime(),
      completedCount,
      declaredCount,
    };
  });
}

/** Per-meeting attendance detail for the admin `?tab=presence` view. */
export type AdminMeetingAttendanceState = 'complete' | 'partielle' | 'absent' | 'cancelled';

/** One meeting row as the admin presence tab consumes it (read-only). */
export interface AdminMemberMeetingView {
  id: string;
  slot: MeetingSlotName;
  scheduledAt: string;
  status: 'scheduled' | 'cancelled';
  /**
   * Admin-viewed state of THIS member on THIS meeting. `complete` = mode set
   * AND content read · `partielle` = one of the two · `absent` = nothing
   * declared (neutral — never "honteux", SPEC §30.7) · `cancelled` = slot
   * cancelled (greyed, excluded from the rate).
   */
  state: AdminMeetingAttendanceState;
}

export interface AdminMemberAttendanceResult {
  meetings: AdminMemberMeetingView[];
  /** The member's attendance rate over the same 30d window (cancelled excluded). */
  rate: MeetingAttendanceRateResult;
}

/**
 * Admin read-only view of one member's meeting attendance over the rolling 30d
 * window: the per-meeting detail list (complete / partielle / absent /
 * cancelled-greyed) + the honest attendance rate.
 *
 * Mirrors {@link listMeetingsForMember} (same window, same rate source via
 * `computeMeetingAttendanceRate`) but admin-viewed: there is no `declarable`
 * affordance, and the "not declared" state is labelled `absent` (admin signal,
 * SPEC §30.4) rather than the member-facing `en_attente`. Cancelled slots are
 * returned (greyed in the UI) but excluded from BOTH numerator and denominator
 * (SPEC §30.3 — `status='scheduled'` filter), so a cancelled slot can never
 * penalise the member. PII-free posture §2: no Ichor content, booleans only.
 */
export async function listMeetingAttendanceForMember(
  memberId: string,
  now: Date = new Date(),
): Promise<AdminMemberAttendanceResult> {
  const user = await db.user.findUnique({
    where: { id: memberId },
    select: { joinedAt: true },
  });
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
        where: { userId: memberId },
        select: { attendanceMode: true, contentReviewed: true },
        take: 1,
      },
    },
  });

  let scheduledCount = 0;
  let completedCount = 0;

  const meetings: AdminMemberMeetingView[] = rows.map((m) => {
    const att = m.attendances[0] ?? null;
    const attendanceMode = att?.attendanceMode ?? null;
    const contentReviewed = att?.contentReviewed ?? false;
    const complete = attendanceMode !== null && contentReviewed === true;

    let state: AdminMeetingAttendanceState;
    if (m.status === 'cancelled') {
      state = 'cancelled';
    } else if (complete) {
      state = 'complete';
    } else if (attendanceMode !== null || contentReviewed) {
      state = 'partielle';
    } else {
      state = 'absent';
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
      state,
    };
  });

  return { meetings, rate: computeMeetingAttendanceRate(scheduledCount, completedCount) };
}
