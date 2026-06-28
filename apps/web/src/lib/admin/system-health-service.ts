import 'server-only';

import { db } from '@/lib/db';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { listMeetingsForAdmin, ADMIN_MEETING_WINDOW_DAYS } from '@/lib/meeting/service';

/**
 * S10(a) — admin BUSINESS-CHAIN health overview (`/admin/health`).
 *
 * Distinct from `/admin/system` (crons OPS observability): this answers « la
 * chaîne métier tourne-t-elle ? » — a single cohort-wide read that aggregates
 * (1) recent check-in fill, (2) truth gaps by status, (3) meeting attendance
 * recoupements, (4) recent score movements. It NEVER recomputes a score and
 * NEVER reads any capture CONTENT (no `responses`/`confidenceLevel`, no P&L) —
 * it folds counts/aggregates ALREADY persisted by the verification + meeting
 * pipelines (§21.5 isolation by construction).
 *
 * **Trust boundary**: like `attention-service` / `members-service`, every
 * function assumes the caller is an authenticated admin — the `/admin/*` page
 * gate is the single source of truth. READ-ONLY (no writer is ever called).
 *
 * Posture §2: count-only facts (counts, `ScoreEvent.reason`, `gapCount`,
 * discrepancy statuses), never a verdict, never market advice. The page renders
 * them with calm tones (acc/warn/mute) — never a punitive red.
 *
 * Performance: one `Promise.all` of bounded aggregates over indexed columns
 * (`Discrepancy.@@index([memberId, status])`,
 * `ScoreEvent.@@index([memberId, createdAt])`) plus the existing bounded
 * `listMeetingsForAdmin` window. No N+1.
 */

const DAY_MS = 86_400_000;

/** Window for "recent" check-in fill + score movements — short enough to read
 *  "is the daily loop alive right now", long enough to smooth a quiet weekend. */
export const HEALTH_RECENT_DAYS = 7;

/** Every score-event reason the fold reports (mirror `ScoreEventReason` enum). */
type ScoreReason = 'filled' | 'forgot_no_reason' | 'reality_gap' | 'false_declaration';

export interface CheckinFillHealth {
  /** Check-in rows (any slot) created in the recent civil-day window. */
  recentCheckins: number;
}

export interface TruthGapHealth {
  open: number;
  acknowledged: number;
  resolved: number;
  /** Convenience total over the three statuses (all non-deleted members). */
  total: number;
}

export interface MeetingPresenceHealth {
  /** Meetings in the admin window (recent + upcoming, `listMeetingsForAdmin`). */
  meetings: number;
  /** Sum of COMPLETE attendances across those meetings. */
  completed: number;
  /** Sum of members who declared SOMETHING (complete or partial). */
  declared: number;
  /** Sum of unresolved admin↔membre presence écarts (`gapCount`). */
  gaps: number;
}

export interface ScoreMovementHealth {
  filled: number;
  forgot_no_reason: number;
  reality_gap: number;
  false_declaration: number;
  /** filled − (forgot + reality_gap + false_declaration): net direction sign. */
  net: number;
  /** Total events folded in the window (positive + negative). */
  total: number;
}

export interface SystemHealthOverview {
  checkins: CheckinFillHealth;
  truthGaps: TruthGapHealth;
  meetings: MeetingPresenceHealth;
  scoreMovements: ScoreMovementHealth;
  /** Repetition alerts (psychological, §33.8) created in the recent window. */
  recentAlerts: number;
  /** Time windows surfaced so the page can NEVER mislabel its period. */
  windows: {
    checkinDays: number;
    scoreDays: number;
    alertDays: number;
    meetingDays: number;
  };
  /** Instant the overview was computed (page renders « à HH:mm »). */
  computedAt: Date;
}

/**
 * One cohort-wide READ of the business chain. `now` is injectable for tests /
 * deterministic windows. Six bounded reads in one `Promise.all`.
 */
export async function getSystemHealthOverview(
  now: Date = new Date(),
): Promise<SystemHealthOverview> {
  // Check-in fill is keyed on `@db.Date` (civil day, Europe/Paris canon) — pin
  // the floor to a UTC-midnight civil date (mirror constancy.ts), never a raw
  // timestamp, so the count lines up with how check-ins are stored.
  const checkinFloor = parseLocalDate(
    shiftLocalDate(localDateOf(now, 'Europe/Paris'), -(HEALTH_RECENT_DAYS - 1)),
  );
  const scoreFloor = new Date(now.getTime() - HEALTH_RECENT_DAYS * DAY_MS);
  const alertFloor = scoreFloor;

  const [recentCheckins, gapsByStatus, scoreByReason, recentAlerts, meetings] = await Promise.all([
    db.dailyCheckin.count({
      where: { date: { gte: checkinFloor }, user: { status: { not: 'deleted' } } },
    }),
    db.discrepancy.groupBy({
      by: ['status'],
      where: { member: { status: { not: 'deleted' } } },
      _count: { _all: true },
    }),
    db.scoreEvent.groupBy({
      by: ['reason'],
      where: {
        createdAt: { gte: scoreFloor },
        member: { status: { not: 'deleted' } },
      },
      _count: { _all: true },
    }),
    db.alert.count({
      where: { createdAt: { gte: alertFloor }, member: { status: { not: 'deleted' } } },
    }),
    listMeetingsForAdmin(now),
  ]);

  // Truth gaps by status → a zeroed shape so the page never reads `undefined`.
  const truthGaps: TruthGapHealth = { open: 0, acknowledged: 0, resolved: 0, total: 0 };
  for (const row of gapsByStatus) {
    const n = row._count._all;
    if (row.status === 'open') truthGaps.open = n;
    else if (row.status === 'acknowledged') truthGaps.acknowledged = n;
    else if (row.status === 'resolved') truthGaps.resolved = n;
    truthGaps.total += n;
  }

  // Score movements by reason → zeroed shape + net direction.
  const reasonCounts: Record<ScoreReason, number> = {
    filled: 0,
    forgot_no_reason: 0,
    reality_gap: 0,
    false_declaration: 0,
  };
  // Route known reasons into the typed shape, but fold EVERY row into `total` so a
  // future `ScoreEventReason` can never be silently dropped from the movement count
  // (§0 — `total` stays honest to its docstring « Total events folded »). `net`
  // keeps its signed meaning over the KNOWN reasons (an unknown reason carries no
  // known sign, so it must not tilt the direction either way).
  let foldedTotal = 0;
  for (const row of scoreByReason) {
    foldedTotal += row._count._all;
    if (row.reason in reasonCounts) reasonCounts[row.reason as ScoreReason] = row._count._all;
  }
  const negatives =
    reasonCounts.forgot_no_reason + reasonCounts.reality_gap + reasonCounts.false_declaration;
  const scoreMovements: ScoreMovementHealth = {
    ...reasonCounts,
    net: reasonCounts.filled - negatives,
    total: foldedTotal,
  };

  // Meeting presence → fold the admin window into 4 totals (count-only, §2).
  const meetingPresence: MeetingPresenceHealth = {
    meetings: 0,
    completed: 0,
    declared: 0,
    gaps: 0,
  };
  for (const m of meetings) {
    meetingPresence.meetings += 1;
    meetingPresence.completed += m.completedCount;
    meetingPresence.declared += m.declaredCount;
    meetingPresence.gaps += m.gapCount;
  }

  return {
    checkins: { recentCheckins },
    truthGaps,
    meetings: meetingPresence,
    scoreMovements,
    recentAlerts,
    windows: {
      checkinDays: HEALTH_RECENT_DAYS,
      scoreDays: HEALTH_RECENT_DAYS,
      alertDays: HEALTH_RECENT_DAYS,
      meetingDays: ADMIN_MEETING_WINDOW_DAYS,
    },
    computedAt: now,
  };
}
