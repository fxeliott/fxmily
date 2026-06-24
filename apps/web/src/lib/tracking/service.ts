import 'server-only';

import { db } from '@/lib/db';

import type { TrackingAxisId } from './axes';
import { computeNextDueAt, computeOccurrenceKey, isDue } from './cadence';
import { computeCoverage, type TrackingCoverage } from './coverage';
import { getCurrentInstrument, getCurrentInstruments, getInstrument } from './registry';
import { buildSubmissionSchema, type TrackingSubmission } from './schema';
import type { TrackingInstrument } from './types';

/**
 * V2 S2 — Universal tracking-engine service layer.
 *
 * User-scoped strict — every function takes a `userId` and never touches
 * another member's rows (defence-in-depth on top of the Server Action's
 * `auth()` re-check, mirror `lib/mindset/service.ts`).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5/§27.7 — BLOCKING, by construction).
 * Writes touch ONLY `db.trackingEntry` / `db.trackingSchedule` (the engine's
 * own 0-FK tables). The D1 coverage read additionally aggregates EXISTING
 * surfaces, but COUNT/RECENCY ONLY (`_max` of a timestamp) — it NEVER selects a
 * P&L (`realizedR`/`outcome`/`plannedRR`), NEVER reads `db.trade` /
 * `db.behavioralScore`, and feeds NOTHING into scoring/triggers. This mirrors
 * the count-only `lib/calendar/snapshot.ts` pattern. The gauge is a calm
 * completeness read (§2/§31.2), never a score or a streak.
 *
 * POSTURE §2: `responses` is validated against a CLOSED instrument schema
 * (`buildSubmissionSchema`) — no free-text, no market content can be persisted.
 */

// =============================================================================
// Errors
// =============================================================================

export class UnknownInstrumentError extends Error {
  constructor(key: string, version: string) {
    super(`Unknown tracking instrument: ${key}@${version}`);
    this.name = 'UnknownInstrumentError';
  }
}

// =============================================================================
// Public types
// =============================================================================

/** JSON-safe view of a `TrackingEntry`. */
export interface SerializedTrackingEntry {
  id: string;
  instrumentKey: string;
  instrumentVersion: string;
  axis: TrackingAxisId;
  occurrenceKey: string;
  responses: Record<string, unknown>;
  confidenceLevel: number | null;
  captureContext: TrackingSubmission['captureContext'] | null;
  responseLatencyMs: number | null;
  promptedAt: string | null; // ISO
  submittedAt: string; // ISO
}

export interface SubmitTrackingEntryResult {
  entry: SerializedTrackingEntry;
  /** True if the occurrence didn't exist before (upsert create branch). */
  wasNew: boolean;
}

/** A currently-due instrument the calm guidance surface can offer. */
export interface DueTrackingInstrument {
  instrument: TrackingInstrument;
  /** When it became due (the schedule's `nextDueAt`). */
  dueSince: string; // ISO
}

// =============================================================================
// Helpers
// =============================================================================

function toSerialized(row: {
  id: string;
  instrumentKey: string;
  instrumentVersion: string;
  axis: TrackingAxisId;
  occurrenceKey: string;
  responses: unknown;
  confidenceLevel: number | null;
  captureContext: SerializedTrackingEntry['captureContext'];
  responseLatencyMs: number | null;
  promptedAt: Date | null;
  submittedAt: Date;
}): SerializedTrackingEntry {
  return {
    id: row.id,
    instrumentKey: row.instrumentKey,
    instrumentVersion: row.instrumentVersion,
    axis: row.axis,
    occurrenceKey: row.occurrenceKey,
    responses:
      typeof row.responses === 'object' && row.responses !== null && !Array.isArray(row.responses)
        ? (row.responses as Record<string, unknown>)
        : {},
    confidenceLevel: row.confidenceLevel,
    captureContext: row.captureContext ?? null,
    responseLatencyMs: row.responseLatencyMs,
    promptedAt: row.promptedAt ? row.promptedAt.toISOString() : null,
    submittedAt: row.submittedAt.toISOString(),
  };
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Validate + persist one tracking capture. Idempotent: upserts on
 * `(userId, instrumentKey, occurrenceKey)` so a re-submit of the same
 * occurrence updates in place (never duplicates — DoD case 7, no broken
 * double-tap). Resolves the FROZEN instrument by the submitted `(key, version)`
 * (a stored entry always pins its version); validation is instrument-strict.
 *
 * After a successful write, the per-(user, instrument) schedule is advanced
 * (`lastCompletedAt = now`, `nextDueAt = computeNextDueAt`) so the recurring
 * cadence stays correct (DoD case 4: spread, never piled up).
 *
 * @throws {UnknownInstrumentError} if `(key, version)` is not a shipped instrument.
 * @throws {z.ZodError} if the payload fails instrument-strict validation.
 */
export async function submitTrackingEntry(
  userId: string,
  raw: unknown,
  options: { now?: Date; timezone?: string } = {},
): Promise<SubmitTrackingEntryResult> {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? 'Europe/Paris';

  // 1. Peek at the (key, version) to resolve the frozen instrument.
  const head = raw as { instrumentKey?: unknown; instrumentVersion?: unknown };
  const key = typeof head?.instrumentKey === 'string' ? head.instrumentKey : '';
  const version = typeof head?.instrumentVersion === 'string' ? head.instrumentVersion : '';
  const instrument = getInstrument(key, version);
  if (!instrument) {
    throw new UnknownInstrumentError(key || '(missing)', version || '(missing)');
  }

  // 2. Instrument-strict validation (server is the only authority).
  const submission = buildSubmissionSchema(instrument).parse(raw);

  // Anti-tamper (mirror MindsetCheck §27.3 service-computed weekEnd): for a
  // scheduled cadence the occurrence is DERIVED from `now`, never trusted from
  // the client — a member can't overwrite another period's entry. Only
  // per_trade/manual use the client-supplied key as an event nonce.
  const occurrenceKey =
    instrument.cadence.kind === 'per_trade' || instrument.cadence.kind === 'manual'
      ? submission.occurrenceKey
      : computeOccurrenceKey(instrument.cadence, now, timezone);

  // 3. Idempotent upsert on the occurrence key.
  const existing = await db.trackingEntry.findUnique({
    where: {
      userId_instrumentKey_occurrenceKey: {
        userId,
        instrumentKey: instrument.key,
        occurrenceKey,
      },
    },
    select: { id: true },
  });

  const data = {
    axis: instrument.axis,
    responses: submission.responses as object,
    confidenceLevel: submission.confidenceLevel ?? null,
    captureContext: submission.captureContext ?? instrument.defaultCaptureContext,
    responseLatencyMs: submission.responseLatencyMs ?? null,
    promptedAt: submission.promptedAt ? new Date(submission.promptedAt) : null,
    submittedAt: now,
  };

  const row = await db.trackingEntry.upsert({
    where: {
      userId_instrumentKey_occurrenceKey: {
        userId,
        instrumentKey: instrument.key,
        occurrenceKey,
      },
    },
    create: {
      userId,
      instrumentKey: instrument.key,
      instrumentVersion: instrument.version,
      occurrenceKey,
      ...data,
    },
    update: {
      instrumentVersion: instrument.version,
      ...data,
    },
  });

  // 4. Advance the recurring schedule (weekly/daily only — per_trade/manual have
  //    no sweep). Best-effort: a schedule write must never fail the capture.
  const nextDueAt = computeNextDueAt(instrument.cadence, now, timezone);
  if (nextDueAt) {
    await db.trackingSchedule.upsert({
      where: { userId_instrumentKey: { userId, instrumentKey: instrument.key } },
      create: { userId, instrumentKey: instrument.key, nextDueAt, lastCompletedAt: now },
      update: { nextDueAt, lastCompletedAt: now },
    });
  }

  return { entry: toSerialized(row), wasNew: existing == null };
}

/**
 * Snooze an instrument until `until` (member-set, anti-overload — DoD case 4).
 * Upserts the schedule so a never-seen instrument can still be paused. SPEC §2:
 * pausing is calm self-pacing, never penalised.
 */
export async function pauseTrackingInstrument(
  userId: string,
  instrumentKey: string,
  until: Date,
  now: Date = new Date(),
): Promise<void> {
  await db.trackingSchedule.upsert({
    where: { userId_instrumentKey: { userId, instrumentKey } },
    create: { userId, instrumentKey, nextDueAt: now, pausedUntil: until },
    update: { pausedUntil: until },
  });
}

// =============================================================================
// Reads (user-scoped)
// =============================================================================

/** A member's entries for one instrument, newest first (bounded 1..104). */
export async function listTrackingEntries(
  userId: string,
  instrumentKey: string,
  limit = 26,
): Promise<SerializedTrackingEntry[]> {
  const rows = await db.trackingEntry.findMany({
    where: { userId, instrumentKey },
    orderBy: { submittedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 104)),
  });
  return rows.map(toSerialized);
}

/** A member's capture for a specific occurrence (prefill / "déjà fait"). */
export async function getTrackingEntry(
  userId: string,
  instrumentKey: string,
  occurrenceKey: string,
): Promise<SerializedTrackingEntry | null> {
  const row = await db.trackingEntry.findUnique({
    where: {
      userId_instrumentKey_occurrenceKey: { userId, instrumentKey, occurrenceKey },
    },
  });
  return row ? toSerialized(row) : null;
}

/**
 * D1 completeness gauge across ALL axes. Aggregates the engine's own captures
 * (per-axis most-recent) PLUS count/recency signals from existing surfaces
 * (check-ins, pre-trade, mindset, training, meetings) so the gauge is JUST —
 * it reflects the member's WHOLE tracking surface, not only the new engine.
 *
 * COUNT/RECENCY ONLY — every query is a `_max` of a timestamp, user-scoped, no
 * P&L, no scoring read (§21.5 isolation held by construction).
 */
export async function getTrackingCoverage(
  userId: string,
  now: Date = new Date(),
  windowDays?: number,
): Promise<TrackingCoverage> {
  const [entriesByAxis, preTrade, mindset, training, meetings, morning, evening] =
    await Promise.all([
      db.trackingEntry.groupBy({ by: ['axis'], where: { userId }, _max: { submittedAt: true } }),
      db.preTradeCheck.aggregate({ where: { userId }, _max: { createdAt: true } }),
      db.mindsetCheck.aggregate({ where: { userId }, _max: { updatedAt: true } }),
      db.trainingTrade.aggregate({ where: { userId }, _max: { createdAt: true } }),
      db.meetingAttendance.aggregate({ where: { userId }, _max: { createdAt: true } }),
      db.dailyCheckin.aggregate({
        where: { userId, slot: 'morning' },
        _max: { submittedAt: true },
      }),
      db.dailyCheckin.aggregate({
        where: { userId, slot: 'evening' },
        _max: { submittedAt: true },
      }),
    ]);

  const lastByAxis = new Map<TrackingAxisId, Date | null>();
  const bump = (axis: TrackingAxisId, date: Date | null | undefined): void => {
    if (!date) return;
    const current = lastByAxis.get(axis);
    if (!current || date.getTime() > current.getTime()) lastByAxis.set(axis, date);
  };

  // Engine captures (e.g. risk_discipline via process-fidelity).
  for (const g of entriesByAxis) bump(g.axis, g._max.submittedAt);

  // Existing surfaces → axes (existence/recency only).
  bump('execution', preTrade._max.createdAt);
  bump('emotions_confidence', preTrade._max.createdAt);
  bump('self_work', mindset._max.updatedAt);
  bump('training', training._max.createdAt);
  bump('meeting_presence', meetings._max.createdAt);
  bump('routine', morning._max.submittedAt);
  bump('market_analysis', morning._max.submittedAt);
  bump('sleep_lifestyle', morning._max.submittedAt);
  bump('emotions_confidence', morning._max.submittedAt);
  bump('evening_review', evening._max.submittedAt);
  bump('formation', evening._max.submittedAt);
  bump('emotions_confidence', evening._max.submittedAt);

  return computeCoverage(lastByAxis, now, windowDays);
}

/**
 * Which recurring instruments are DUE for the member right now (past
 * `nextDueAt`, not snoozed). Drives the calm due-prompt in the dashboard
 * `TrackingCoverageWidget` (its sole consumer) — no streak, no urgency (SPEC
 * §2). A member with no schedule row yet for a current
 * instrument is considered due (first-run), so the engine self-bootstraps.
 */
export async function getDueTrackingInstruments(
  userId: string,
  now: Date = new Date(),
): Promise<DueTrackingInstrument[]> {
  const schedules = await db.trackingSchedule.findMany({ where: { userId } });
  const byKey = new Map(schedules.map((s) => [s.instrumentKey, s]));

  const due: DueTrackingInstrument[] = [];
  for (const instrument of getCurrentInstruments()) {
    // per_trade / manual instruments are not schedule-swept.
    if (instrument.cadence.kind !== 'daily' && instrument.cadence.kind !== 'weekly') continue;

    const schedule = byKey.get(instrument.key);
    if (!schedule) {
      // First run: never scheduled → offer it now.
      due.push({ instrument, dueSince: now.toISOString() });
      continue;
    }
    if (isDue({ nextDueAt: schedule.nextDueAt, pausedUntil: schedule.pausedUntil }, now)) {
      due.push({ instrument, dueSince: schedule.nextDueAt.toISOString() });
    }
  }
  return due;
}

/** Resolve the current instrument for a key (thin re-export for callers). */
export function resolveCurrentInstrument(key: string): TrackingInstrument | undefined {
  return getCurrentInstrument(key);
}
