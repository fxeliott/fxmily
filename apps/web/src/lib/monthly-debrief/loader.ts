import 'server-only';

import { db } from '@/lib/db';
import type { SerializedCheckin } from '@/lib/checkin/service';
import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { getLatestBehavioralScore } from '@/lib/scoring/service';
// 🚨 §21.5 — the ONLY symbol the monthly-debrief loader may import from the
// training module: the count-only primitive. Anything else is a breach.
// (Pinned by the anti-leak suite Block A once this file is added to
// SANCTIONED_TOUCHPOINTS — mirror weekly-report/loader.ts:8.)
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
// pseudonymizeMember is the V1.5.2 pure SHA-256 helper (no schema/training
// dependency). SPEC §25.2 decision: the LOADER pre-computes the pseudonym at
// the Claude boundary so the pure aggregator stays import-free and trivially
// §21.5-clean. Importing it from `@/lib/weekly-report/builder` is the
// sanctioned reuse (no extraction = no scope-creep into 3 stable files).
import { pseudonymizeMember } from '@/lib/weekly-report/builder';

import { WEEKLY_CONTEXT_MAX } from '@/lib/schemas/monthly-debrief';

import { computeMonthWindow, computeReportingMonth, type MonthWindow } from './month-window';
import type { BehavioralScoreSnapshot, MonthlyBuilderInput } from './types';

/**
 * J-M2 — DB loader for the V1.4 monthly AI debrief (SPEC §25).
 *
 * Reads the civil-month slice (member's local-month) from Postgres,
 * serializes it to the shape the pure aggregator expects, and returns a
 * {@link MonthlyBuilderInput}. Carbon of `weekly-report/loader.ts` adapted
 * to the monthly cadence + the §25 dual-section snapshot.
 *
 * Pure orchestration : the loader does NOT compute analytics. The pure
 * aggregator (`lib/monthly-debrief/builder.ts`, J-M1) is the only function
 * that turns the slice into a `MonthlySnapshot`.
 *
 * 🚨 §21.5 / §25.7 (BLOCKING). The training side is loaded EXCLUSIVELY via
 * `countRecentTrainingActivity` ({ count, lastEnteredAt } — pinned count/
 * recency-only by anti-leak Block B). The loader derives
 * `daysSinceLastBacktest` from the primitive's `lastEnteredAt` with the
 * member tz + month end ; no backtest P&L is ever selected. The REAL side
 * legitimately reads real-trade rows + the ≤4 sanctioned `WeeklyReport`
 * summaries of the month (INPUT, never an FK — SPEC §25.3). The §25
 * firewall is training-isolation only (anti-leak Block G, tailored ≠
 * Block F).
 *
 * Idempotency : `monthStart`/`monthEnd` are deterministic for a fixed
 * `(now, timezone)`, so two batch runs in the same month produce the exact
 * same slice — `(userId, monthStart)` is unique on `monthly_debriefs`, so
 * the persist path can `upsert` safely.
 */

// =============================================================================
// Public types
// =============================================================================

export interface LoadedMonthlySlice {
  builderInput: MonthlyBuilderInput;
  window: MonthWindow;
  /// Member metadata — joined in the same `findUnique` round-trip as
  /// timezone so the J-M3 member email + audit don't re-query the DB.
  /// SPEC §25.2: the monthly debrief notifies the MEMBER (no admin email).
  userMeta: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface LoadOptions {
  /// `now` reference (batch pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → the just-ended civil month (`computeReportingMonth`,
  /// `now − 24h` anchored — the canonical "1st of the month, report the
  /// month that ended" cadence). `true` → the in-progress civil month
  /// (`computeMonthWindow`, rare preview). Mirror weekly `previousFullWeek`.
  currentMonth?: boolean;
}

// =============================================================================
// Loader
// =============================================================================

export async function loadMonthlySliceForUser(
  userId: string,
  options: LoadOptions = {},
): Promise<LoadedMonthlySlice | null> {
  const now = options.now ?? new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      status: true,
      // Account-age guard (SPEC §25.4 — "membre inscrit en cours de mois →
      // couverture depuis la date d'inscription, IA informée de l'âge").
      joinedAt: true,
      // Pulled in the same round-trip so the J-M3 member email doesn't
      // re-query (SPEC §25.2 — member-facing notification).
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!user || user.status !== 'active') return null;

  // SPEC §25.4 — the batch fires early on the 1st of the month for the
  // just-ended civil month. `computeReportingMonth` anchors on `now − 24h`
  // (exact carbon of `computeReportingWeek`), multi-TZ-safe.
  const window = options.currentMonth
    ? computeMonthWindow(now, user.timezone)
    : computeReportingMonth(now, user.timezone);

  const [
    trades,
    checkins,
    deliveries,
    annotations,
    latestScore,
    trainingActivity,
    weeklySummaries,
  ] = await Promise.all([
    loadTrades(userId, window),
    loadCheckins(userId, window),
    loadDeliveries(userId, window),
    loadAnnotationStats(userId, window),
    getLatestBehavioralScore(userId),
    // 🚨 §21.5 — sanctioned training→debrief touchpoint (the count-only
    // primitive). `.count` is consumed for the volume of practice ;
    // `lastEnteredAt` (all-time most-recent) is used ONLY to derive a
    // recency integer below — never a backtest P&L.
    countRecentTrainingActivity(userId, window.monthStartUtc, window.monthEndUtc),
    loadWeeklySummaries(userId, window),
  ]);

  // SPEC §25.3 — training slice = count/recency ONLY. `daysSinceLastBacktest`
  // is derived here (the loader owns the clock; the pure aggregator stays
  // clock-free). `localDateOf` ⇒ Europe/Paris-anchored, NEVER
  // `toISOString().slice` on a naive instant (invariant §25.7 / PR#96).
  let daysSinceLastBacktest: number | null = null;
  let hasEverPractised = false;
  if (trainingActivity.lastEnteredAt !== null) {
    hasEverPractised = true;
    const lastLocal = localDateOf(new Date(trainingActivity.lastEnteredAt), user.timezone);
    const diffDays = Math.floor(
      (parseLocalDate(window.monthEndLocal).getTime() - parseLocalDate(lastLocal).getTime()) /
        86_400_000,
    );
    // A backtest logged AFTER the reporting month's end (member practised in
    // the in-progress month) clamps to 0 = "très récemment", never negative
    // (schema requires `.min(0)`).
    daysSinceLastBacktest = diffDays < 0 ? 0 : diffDays;
  }

  // SPEC §25.4 — whole days the account existed within the window. Account
  // joined after the month end ⇒ 0 (did not exist in the window); joined
  // before the month start ⇒ full month length; otherwise from the join day.
  const joinedLocal = localDateOf(user.joinedAt, user.timezone);
  const coverageStartLocal =
    joinedLocal > window.monthStartLocal ? joinedLocal : window.monthStartLocal;
  const accountAgeDaysInWindow =
    coverageStartLocal > window.monthEndLocal
      ? 0
      : Math.floor(
          (parseLocalDate(window.monthEndLocal).getTime() -
            parseLocalDate(coverageStartLocal).getTime()) /
            86_400_000,
        ) + 1;

  const builderInput: MonthlyBuilderInput = {
    // SPEC §25.2 — pseudonym pre-computed by the loader at the Claude
    // boundary (8-char hex, salted via env.MEMBER_LABEL_SALT in prod).
    pseudonymLabel: pseudonymizeMember(user.id),
    timezone: user.timezone,
    monthStart: window.monthStartUtc,
    monthEnd: window.monthEndUtc,
    accountAgeDaysInWindow,
    trades,
    checkins,
    deliveries,
    annotationsReceived: annotations.received,
    annotationsViewed: annotations.viewed,
    latestScore: latestScore === null ? null : toScoreSnapshot(latestScore),
    weeklySummaries,
    // 🚨 §21.5 — effort COUNT + recency only. The pure aggregator relays
    // this verbatim; the snapshot schema `.strict()` structurally rejects a
    // smuggled backtest P&L key.
    training: {
      backtestCount: trainingActivity.count,
      daysSinceLastBacktest,
      hasEverPractised,
    },
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
// Per-table queries (private) — carbon weekly loader serializers
// =============================================================================

async function loadTrades(
  userId: string,
  window: MonthWindow,
): Promise<MonthlyBuilderInput['trades']> {
  // "Trades du mois" = trades whose `enteredAt` falls inside the local-month
  // window. Trades opened earlier and still open at month-end are
  // intentionally excluded (they belong to a previous month's debrief and
  // would otherwise double-count). Mirror weekly loader.
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
    },
    orderBy: { enteredAt: 'asc' },
  });

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
    tradeQuality: trade.tradeQuality,
    riskPct: trade.riskPct == null ? null : trade.riskPct.toString(),
    emotionBefore: [...trade.emotionBefore],
    planRespected: trade.planRespected,
    hedgeRespected: trade.hedgeRespected,
    processComplete: trade.processComplete,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    emotionDuring: [...trade.emotionDuring],
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
  }));
}

async function loadCheckins(userId: string, window: MonthWindow): Promise<SerializedCheckin[]> {
  // Check-ins anchor to a `@db.Date` column (calendar day, no time). The
  // local-month → DATE filter uses `parseLocalDate` on the window boundary
  // strings (UTC-midnight Date, canon — never a TZ-drifted slice). §25.7.
  const startDate = parseLocalDate(window.monthStartLocal);
  const endDate = parseLocalDate(window.monthEndLocal);

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
    marketAnalysisDone: row.marketAnalysisDone,
    meditationMin: row.meditationMin,
    sportType: row.sportType,
    sportDurationMin: row.sportDurationMin,
    intention: row.intention,
    planRespectedToday: row.planRespectedToday,
    hedgeRespectedToday: row.hedgeRespectedToday,
    formationFollowed: row.formationFollowed,
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
  window: MonthWindow,
): Promise<MonthlyBuilderInput['deliveries']> {
  const rows = await db.markDouglasDelivery.findMany({
    where: {
      userId,
      createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
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
  window: MonthWindow,
): Promise<{ received: number; viewed: number }> {
  // Admin annotations authored on THIS member's REAL trades during the
  // window. `seenByMemberAt IS NOT NULL` → counted as viewed. (Real-edge
  // coaching — the §25 firewall is training-isolation only, real annotations
  // are legitimate, mirror weekly loader.)
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
      trade: { userId },
    },
    select: { id: true, seenByMemberAt: true },
  });
  const viewed = rows.filter((r) => r.seenByMemberAt !== null).length;
  return { received: rows.length, viewed };
}

async function loadWeeklySummaries(userId: string, window: MonthWindow): Promise<string[]> {
  // SPEC §25.3 — the ≤4 `WeeklyReport` of the civil month are ingested as
  // INPUT context (the month-over-month progression narrative), NEVER an
  // FK (isolation §21.5 by construction). `weekStart` is a `@db.Date`
  // (member-local Monday) → DATE-filter on the window boundaries; only the
  // `summary` is selected (no PII, no cost columns). Newest-first; the pure
  // aggregator caps at WEEKLY_CONTEXT_MAX + re-hardens defense-in-depth.
  const rows = await db.weeklyReport.findMany({
    where: {
      userId,
      weekStart: {
        gte: parseLocalDate(window.monthStartLocal),
        lte: parseLocalDate(window.monthEndLocal),
      },
    },
    select: { summary: true },
    orderBy: { weekStart: 'desc' },
    take: WEEKLY_CONTEXT_MAX,
  });
  return rows.map((r) => r.summary);
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
