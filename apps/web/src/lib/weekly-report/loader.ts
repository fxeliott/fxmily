import 'server-only';

import { db } from '@/lib/db';
import type { SerializedCheckin } from '@/lib/checkin/service';
import { getLatestBehavioralScore } from '@/lib/scoring/service';

import type { BehavioralScoreSnapshot, BuilderInput } from './types';
import {
  computePreviousFullWeekWindow,
  computeReportingWeek,
  type WeekWindow,
} from './week-window';

/**
 * Phase B — DB loader for the J8 weekly report.
 *
 * Reads the 7-day slice (member's local-week) from Postgres, serializes it to
 * the shape the pure-functions builder expects, and returns a {@link BuilderInput}.
 *
 * Pure orchestration : the loader does NOT compute analytics. The builder
 * (Phase A, `lib/weekly-report/builder.ts`) is the only function that turns
 * the slice into a {@link WeeklySnapshot}.
 *
 * Idempotency : the `weekStart`/`weekEnd` returned here are deterministic for a
 * fixed `(now, timezone)`, so two cron runs on the same Sunday will produce
 * the exact same slice — `(userId, weekStart)` is unique on the
 * `weekly_reports` table, so the orchestrator can `upsert` safely.
 */

// =============================================================================
// Public types
// =============================================================================

export interface LoadedWeeklySlice {
  builderInput: BuilderInput;
  window: WeekWindow;
  /// Member metadata — joined in the same `findUnique` round-trip as
  /// timezone, so downstream layers (email, audit) don't re-query the DB.
  /// J8 perf TIER 2 (T2.1) economy : 30 members × 1 round-trip saved.
  userMeta: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface LoadOptions {
  /// `now` reference (cron pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → current local-week. `true` → previous full local-week
  /// (Mon→Sun BEFORE `now`'s week). The cron sticks to the default.
  previousFullWeek?: boolean;
}

// =============================================================================
// Loader
// =============================================================================

export async function loadWeeklySliceForUser(
  userId: string,
  options: LoadOptions = {},
): Promise<LoadedWeeklySlice | null> {
  const now = options.now ?? new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      status: true,
      // J8 perf TIER 2 (T2.1) — pull email metadata in same round-trip so
      // downstream `maybeSendEmail` doesn't re-query for member label.
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!user || user.status !== 'active') return null;

  // J8 audit fix — `computeReportingWeek(now)` anchors on `now - 24h` so the
  // Sunday 21:00 UTC cron correctly reports "the week that just ended"
  // regardless of member timezone (Paris stays on the current week, Tokyo
  // rolls back to last week instead of jumping forward 6 days).
  const window = options.previousFullWeek
    ? computePreviousFullWeekWindow(now, user.timezone)
    : computeReportingWeek(now, user.timezone);

  const [trades, checkins, deliveries, annotations, latestScore] = await Promise.all([
    loadTrades(userId, window),
    loadCheckins(userId, window),
    loadDeliveries(userId, window),
    loadAnnotationStats(userId, window),
    getLatestBehavioralScore(userId),
  ]);

  const builderInput: BuilderInput = {
    userId: user.id,
    timezone: user.timezone,
    weekStart: window.weekStartUtc,
    weekEnd: window.weekEndUtc,
    trades,
    checkins,
    deliveries,
    annotationsReceived: annotations.received,
    annotationsViewed: annotations.viewed,
    latestScore: latestScore === null ? null : toScoreSnapshot(latestScore),
  };

  return {
    builderInput,
    window,
    userMeta: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
}

// =============================================================================
// Per-table queries (private)
// =============================================================================

async function loadTrades(userId: string, window: WeekWindow): Promise<BuilderInput['trades']> {
  // "Trades de la semaine" = trades whose `enteredAt` falls inside the local-
  // week window. Trades opened earlier and still open at week-end are
  // intentionally excluded — they belong to a previous week's report and the
  // counters would otherwise double-count them.
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
    },
    orderBy: { enteredAt: 'asc' },
  });

  // Inline serialize — we don't import `toSerialized` from `lib/trades/service`
  // because that helper is private. Replicating the shape here keeps the
  // service layer free of cross-module side-channels.
  return rows.map((trade) => ({
    id: trade.id,
    userId: trade.userId,
    pair: trade.pair,
    direction: trade.direction,
    session: trade.session,
    enteredAt: trade.enteredAt.toISOString(),
    entryPrice: trade.entryPrice.toString(),
    lotSize: trade.lotSize.toString(),
    stopLossPrice: trade.stopLossPrice == null ? null : trade.stopLossPrice.toString(),
    plannedRR: trade.plannedRR.toString(),
    // V1.5 — Steenbarger setup quality + Tharp risk %.
    tradeQuality: trade.tradeQuality,
    riskPct: trade.riskPct == null ? null : trade.riskPct.toString(),
    emotionBefore: [...trade.emotionBefore],
    planRespected: trade.planRespected,
    hedgeRespected: trade.hedgeRespected,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
  }));
}

async function loadCheckins(userId: string, window: WeekWindow): Promise<SerializedCheckin[]> {
  // Check-ins anchor to a `@db.Date` column (calendar day, no time). Local-week
  // → DATE filter via the local-date strings of the window boundaries.
  const startDate = parseDbDate(window.weekStartLocal);
  const endDate = parseDbDate(window.weekEndLocal);

  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: 'asc' }, { slot: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    slot: row.slot,
    sleepHours: row.sleepHours == null ? null : row.sleepHours.toString(),
    sleepQuality: row.sleepQuality,
    morningRoutineCompleted: row.morningRoutineCompleted,
    meditationMin: row.meditationMin,
    sportType: row.sportType,
    sportDurationMin: row.sportDurationMin,
    intention: row.intention,
    planRespectedToday: row.planRespectedToday,
    hedgeRespectedToday: row.hedgeRespectedToday,
    caffeineMl: row.caffeineMl,
    waterLiters: row.waterLiters == null ? null : row.waterLiters.toString(),
    stressScore: row.stressScore,
    gratitudeItems: [...row.gratitudeItems],
    moodScore: row.moodScore,
    emotionTags: [...row.emotionTags],
    journalNote: row.journalNote,
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function loadDeliveries(
  userId: string,
  window: WeekWindow,
): Promise<BuilderInput['deliveries']> {
  // Deliveries created during the week. We use `createdAt` (not `triggeredOn`)
  // because the trigger engine sets `createdAt` at dispatch time — that's when
  // the member effectively received the card.
  const rows = await db.markDouglasDelivery.findMany({
    where: {
      userId,
      createdAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
    },
    include: { card: { select: { slug: true, title: true, category: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    cardSlug: row.card.slug,
    cardTitle: row.card.title,
    cardCategory: row.card.category,
    triggeredBy: row.triggeredBy,
    triggeredOn: row.triggeredOn.toISOString().slice(0, 10),
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    helpful: row.helpful,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function loadAnnotationStats(
  userId: string,
  window: WeekWindow,
): Promise<{ received: number; viewed: number }> {
  // Annotations the admin authored on THIS member's trades during the window.
  // `seenByMemberAt` IS NOT NULL → counted as viewed.
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
      trade: { userId },
    },
    select: { id: true, seenByMemberAt: true },
  });
  const viewed = rows.filter((r) => r.seenByMemberAt !== null).length;
  return { received: rows.length, viewed };
}

// =============================================================================
// Helpers
// =============================================================================

function toScoreSnapshot(latest: {
  disciplineScore: number | null;
  emotionalStabilityScore: number | null;
  consistencyScore: number | null;
  engagementScore: number | null;
}): BehavioralScoreSnapshot {
  return {
    discipline: latest.disciplineScore,
    emotionalStability: latest.emotionalStabilityScore,
    consistency: latest.consistencyScore,
    engagement: latest.engagementScore,
  };
}

function parseDbDate(local: string): Date {
  // Mirrors `parseLocalDate` from `lib/checkin/timezone` for callers that don't
  // need the additional roundtrip validation. Same shape (UTC midnight Date).
  const [y, m, d] = local.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
