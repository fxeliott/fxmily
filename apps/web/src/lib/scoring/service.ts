import 'server-only';

import { Prisma } from '@/generated/prisma/client';

import {
  localDateOf,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

import { computeConsistencyScore, type ConsistencyTradeInput } from './consistency';
import {
  computeDisciplineScore,
  type DisciplineCheckinInput,
  type DisciplineTradeInput,
} from './discipline';
import {
  computeEmotionalStabilityScore,
  type EmotionalStabilityCheckinInput,
  type EmotionalStabilityTradeInput,
} from './emotional-stability';
import { computeEngagementScore, type EngagementCheckinInput } from './engagement';
import {
  asInputJson,
  type AllScoresResult,
  type ComponentsJson,
  type SampleSizeJson,
} from './types';

/**
 * Behavioral score service (SPEC §6.10, §7.5, §7.11).
 *
 * Public surface:
 *   - `computeScoresForUser(userId, asOf?, options?)` — pure orchestration:
 *      pulls trades + check-ins, runs the four scoring functions, returns
 *      a `SerializedBehavioralScore` (does NOT persist).
 *   - `persistBehavioralScore(userId, scores)` — upsert on (userId, date).
 *   - `recomputeAndPersist(userId, asOf?, options?)` — sugar.
 *   - `recomputeAllActiveMembers(now?)` — batch wrapper for the cron.
 *
 * The split lets the cron persist + audit while a future on-demand path
 * (post-trade-close) can `revalidateTag` without going through the upsert.
 *
 * Window: rolling 30 days ending on `asOf` (default: yesterday in user TZ).
 * The "yesterday" default matches industry-standard nightly-snapshot pattern
 * (TradeZella, prop firms 2026 reviews) — `today` is partial.
 */

const DEFAULT_WINDOW_DAYS = 30;

export interface SerializedBehavioralScore {
  id: string;
  userId: string;
  /** Local-day anchor (YYYY-MM-DD). */
  date: LocalDateString;
  disciplineScore: number | null;
  emotionalStabilityScore: number | null;
  consistencyScore: number | null;
  engagementScore: number | null;
  components: ComponentsJson;
  sampleSize: SampleSizeJson;
  windowDays: number;
  computedAt: string;
}

export interface ComputeScoresOptions {
  /** Window length in days. Default 30. */
  windowDays?: number;
  /** Override the user's stored timezone. Used by tests. */
  timezone?: string;
}

/**
 * Run the four scoring formulas over a member's data window. Pure: does NOT
 * persist. Use `persistBehavioralScore` separately.
 *
 * @param asOf — local-day anchor (YYYY-MM-DD). Default: yesterday in the
 *               user's timezone (industry-standard snapshot policy).
 */
export async function computeScoresForUser(
  userId: string,
  asOf?: LocalDateString,
  options: ComputeScoresOptions = {},
): Promise<{
  result: AllScoresResult;
  components: ComponentsJson;
  sampleSize: SampleSizeJson;
}> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Resolve the user's timezone (Europe/Paris fallback).
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const timezone = options.timezone ?? user?.timezone ?? 'Europe/Paris';

  // Anchor to yesterday-local by default — today is incomplete.
  const today = localDateOf(new Date(), timezone);
  const anchor = asOf ?? shiftLocalDate(today, -1);
  const windowStart = shiftLocalDate(anchor, -(windowDays - 1));

  const windowStartUtc = parseLocalDate(windowStart);
  const windowEndExclusive = parseLocalDate(shiftLocalDate(anchor, 1));

  // Parallel fetch — anti-waterfall.
  const [trades, checkins] = await Promise.all([
    db.trade.findMany({
      where: {
        userId,
        OR: [
          // Closed within the window.
          { closedAt: { gte: windowStartUtc, lt: windowEndExclusive } },
          // Open trades — included so DisciplineScore can see plan-respect on entry.
          { closedAt: null, enteredAt: { gte: windowStartUtc, lt: windowEndExclusive } },
        ],
      },
      select: {
        outcome: true,
        realizedR: true,
        realizedRSource: true,
        closedAt: true,
        exitedAt: true,
        session: true,
        planRespected: true,
        hedgeRespected: true,
      },
    }),
    db.dailyCheckin.findMany({
      where: {
        userId,
        date: { gte: windowStartUtc, lt: windowEndExclusive },
      },
      select: {
        slot: true,
        date: true,
        moodScore: true,
        stressScore: true,
        emotionTags: true,
        planRespectedToday: true,
        morningRoutineCompleted: true,
        intention: true,
        journalNote: true,
      },
    }),
  ]);

  // Map to scoring inputs.
  const disciplineTrades: DisciplineTradeInput[] = trades.map((t) => ({
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    planRespected: t.planRespected,
    hedgeRespected: t.hedgeRespected,
  }));

  const disciplineCheckins: DisciplineCheckinInput[] = checkins.map((c) => ({
    slot: c.slot,
    planRespectedToday: c.planRespectedToday,
    morningRoutineCompleted: c.morningRoutineCompleted,
    intention: c.intention,
  }));

  const emotionalCheckins: EmotionalStabilityCheckinInput[] = checkins.map((c) => ({
    slot: c.slot,
    date: localDateOfDate(c.date, timezone),
    moodScore: c.moodScore,
    stressScore: c.stressScore,
    emotionTags: c.emotionTags,
  }));

  const emotionalTrades: EmotionalStabilityTradeInput[] = trades
    .filter((t) => t.closedAt !== null)
    .map((t) => ({
      closeDay: t.closedAt ? localDateOfDate(t.closedAt, timezone) : null,
      outcome: t.outcome,
    }));

  const consistencyTrades: ConsistencyTradeInput[] = trades
    .filter((t) => t.closedAt !== null)
    .map((t) => ({
      outcome: t.outcome,
      realizedR: t.realizedR == null ? null : t.realizedR.toString(),
      realizedRSource: t.realizedRSource,
      closedAt: t.closedAt!.toISOString(),
      exitedAt: t.exitedAt ? t.exitedAt.toISOString() : null,
      session: t.session,
    }));

  const engagementCheckins: EngagementCheckinInput[] = checkins.map((c) => ({
    date: localDateOfDate(c.date, timezone),
    slot: c.slot,
    journalNote: c.journalNote,
  }));

  // Compute streak in-window for engagement (we count distinct days with any
  // check-in at the anchor). The "current streak" semantic from
  // `lib/checkin/streak.ts` is intentionally NOT reused here — that one is a
  // global member-level number; engagement.streakNormalized is window-bounded.
  const distinctDates = new Set(checkins.map((c) => localDateOfDate(c.date, timezone)));

  const discipline = computeDisciplineScore({
    trades: disciplineTrades,
    checkins: disciplineCheckins,
    windowDays,
  });
  const emotionalStability = computeEmotionalStabilityScore({
    checkins: emotionalCheckins,
    closedTrades: emotionalTrades,
    windowDays,
  });
  const consistency = computeConsistencyScore({
    trades: consistencyTrades,
    windowDays,
  });
  const engagement = computeEngagementScore({
    checkins: engagementCheckins,
    streak: distinctDates.size,
    windowDays,
  });

  const components: ComponentsJson = { discipline, emotionalStability, consistency, engagement };

  // Sample-size payload for the column + UI disclaimer.
  let morningOnly = 0;
  let eveningOnly = 0;
  let bothSlots = 0;
  const slotsByDay = new Map<string, { morning: boolean; evening: boolean }>();
  for (const c of checkins) {
    const k = localDateOfDate(c.date, timezone);
    const e = slotsByDay.get(k) ?? { morning: false, evening: false };
    if (c.slot === 'morning') e.morning = true;
    if (c.slot === 'evening') e.evening = true;
    slotsByDay.set(k, e);
  }
  for (const e of slotsByDay.values()) {
    if (e.morning && e.evening) bothSlots++;
    else if (e.morning) morningOnly++;
    else if (e.evening) eveningOnly++;
  }

  const closedCount = trades.filter((t) => t.closedAt !== null).length;
  const computedCount = trades.filter((t) => t.realizedRSource === 'computed').length;
  const estimatedCount = trades.filter((t) => t.realizedRSource === 'estimated').length;

  const sampleSize: SampleSizeJson = {
    trades: { closed: closedCount, computed: computedCount, estimated: estimatedCount },
    checkins: { days: slotsByDay.size, morningOnly, eveningOnly, bothSlots },
    windowDays,
  };

  const result: AllScoresResult = {
    discipline,
    emotionalStability,
    consistency,
    engagement,
    windowDays,
    computedAt: new Date().toISOString(),
    date: anchor,
  };

  return { result, components, sampleSize };
}

/**
 * Persist (upsert) a behavioral score snapshot for the given anchor day.
 *
 * @returns the persisted snapshot serialized for the dashboard.
 */
export async function persistBehavioralScore(
  userId: string,
  asOfDate: LocalDateString,
  components: ComponentsJson,
  sampleSize: SampleSizeJson,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<SerializedBehavioralScore> {
  const dateUtc = parseLocalDate(asOfDate);

  const row = await db.behavioralScore.upsert({
    where: { userId_date: { userId, date: dateUtc } },
    create: {
      userId,
      date: dateUtc,
      disciplineScore: components.discipline.score,
      emotionalStabilityScore: components.emotionalStability.score,
      consistencyScore: components.consistency.score,
      engagementScore: components.engagement.score,
      components: asInputJson(components),
      sampleSize: asInputJson(sampleSize),
      windowDays,
    },
    update: {
      disciplineScore: components.discipline.score,
      emotionalStabilityScore: components.emotionalStability.score,
      consistencyScore: components.consistency.score,
      engagementScore: components.engagement.score,
      components: asInputJson(components),
      sampleSize: asInputJson(sampleSize),
      windowDays,
      computedAt: new Date(),
    },
  });

  return serializeBehavioralScore(row);
}

/**
 * One-shot "compute and persist" used by the cron + Server Actions.
 */
export async function recomputeAndPersist(
  userId: string,
  asOf?: LocalDateString,
  options: ComputeScoresOptions = {},
): Promise<SerializedBehavioralScore> {
  const { result, components, sampleSize } = await computeScoresForUser(userId, asOf, options);
  return persistBehavioralScore(userId, result.date, components, sampleSize, result.windowDays);
}

export interface RecomputeBatchResult {
  computed: number;
  skipped: number;
  errors: number;
  /** ISO timestamp of the cron run (single point in time). */
  ranAt: string;
  /** When `now` is passed in tests, the local-day anchor used. */
  anchor?: LocalDateString;
}

/**
 * Recompute snapshots for every active member in batches. Used by the cron.
 *
 * `Promise.allSettled` over batches of 25 — bounded concurrency to keep
 * Postgres pool happy. Errors per-user are logged but do not fail the batch.
 */
export async function recomputeAllActiveMembers(
  now?: Date,
  options: ComputeScoresOptions = {},
): Promise<RecomputeBatchResult> {
  const ranAt = (now ?? new Date()).toISOString();
  const batchSize = 25;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true, timezone: true },
  });

  let computed = 0;
  const skipped = 0;
  let errors = 0;

  // Compute the anchor in each user's TZ — different members may sit in
  // different timezones (V1 default Europe/Paris, but the column exists).
  for (let i = 0; i < users.length; i += batchSize) {
    const slice = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map((u) => recomputeAndPersist(u.id, undefined, { ...options, timezone: u.timezone })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        computed++;
      } else {
        errors++;
        console.error('[scoring] recompute failed:', r.reason);
      }
    }
  }

  // Track skipped count for parity with the cron audit shape — V1 has none
  // (every active user is computed), but the reporting shape supports it.
  return { computed, skipped, errors, ranAt };
}

// ----- Helpers ---------------------------------------------------------------

function serializeBehavioralScore(row: {
  id: string;
  userId: string;
  date: Date;
  disciplineScore: number | null;
  emotionalStabilityScore: number | null;
  consistencyScore: number | null;
  engagementScore: number | null;
  components: Prisma.JsonValue;
  sampleSize: Prisma.JsonValue;
  windowDays: number;
  computedAt: Date;
}): SerializedBehavioralScore {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    disciplineScore: row.disciplineScore,
    emotionalStabilityScore: row.emotionalStabilityScore,
    consistencyScore: row.consistencyScore,
    engagementScore: row.engagementScore,
    components: row.components as unknown as ComponentsJson,
    sampleSize: row.sampleSize as unknown as SampleSizeJson,
    windowDays: row.windowDays,
    computedAt: row.computedAt.toISOString(),
  };
}

/** Read a Postgres `@db.Date` (parsed by Prisma into a UTC midnight Date) as
 * the user's local-day. */
function localDateOfDate(d: Date, timezone: string): LocalDateString {
  return localDateOf(d, timezone);
}

/**
 * Read the latest snapshot for a user (dashboard use). Returns null if none
 * exists yet — typical for a brand-new member before the first cron run.
 */
export async function getLatestBehavioralScore(
  userId: string,
): Promise<SerializedBehavioralScore | null> {
  const row = await db.behavioralScore.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });
  return row === null ? null : serializeBehavioralScore(row);
}
