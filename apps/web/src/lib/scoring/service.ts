import 'server-only';

import { Prisma } from '@/generated/prisma/client';

import {
  localDateOf,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
// SPEC §30.4 J-M4 — the count-only meeting-attendance primitive (different
// module from training: `@/lib/meeting`, so it does NOT touch the single
// `@/lib/training` import the anti-leak firewall pins on this touchpoint).
// Returns two integers ({ scheduledCount, completedCount }); no meeting body,
// no P&L. Feeds engagement ONLY (SPEC §30.7 — assiduité touches no real edge).
import { countMeetingAttendance } from '@/lib/meeting/service';
// §30.7 T3-1 — floors the meeting denominator at the member's join day.
import { floorMeetingWindowAtJoin } from '@/lib/meeting/window';
import { reportWarning } from '@/lib/observability';
// 🚨 §21.5 — the ONLY symbol scoring may import from the training module: a
// count-only primitive. Importing anything else (a serialized backtest,
// `db.trainingTrade`, a P&L field) is a statistical-isolation breach asserted
// against by the blocking anti-leak suite.
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';

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
  /**
   * The member's join day. Supplied by the cron loop (alongside `timezone`) so
   * the per-user `db.user` round-trip stays skipped, and used to FLOOR the
   * meeting-attendance window at join (§30.7 T3-1) — a mid-window joiner is not
   * charged for meetings scheduled before they existed. When omitted, the
   * single-user path reads it from the same `db.user` query as `timezone`.
   */
  joinedAt?: Date;
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

  // Resolve the user's timezone (Europe/Paris fallback). Phase Q.2 perf
  // T1#3 — skip the round-trip when the cron loop already supplied the
  // timezone via options (saves 1000 queries/night at 1000 members).
  const user = options.timezone
    ? null
    : await db.user.findUnique({
        where: { id: userId },
        select: { timezone: true, joinedAt: true },
      });
  const timezone = options.timezone ?? user?.timezone ?? 'Europe/Paris';
  // §30.7 T3-1 — join day for the meeting-window floor. From options (cron path,
  // which supplies it alongside `timezone` to keep the per-user query skipped)
  // or the single-user query above. `null` ⇒ no floor (byte-identical to the
  // pre-fix behaviour), so a caller that passes only `timezone` is unaffected.
  const joinedAt = options.joinedAt ?? user?.joinedAt ?? null;

  // Anchor to yesterday-local by default — today is incomplete.
  const today = localDateOf(new Date(), timezone);
  const anchor = asOf ?? shiftLocalDate(today, -1);
  const windowStart = shiftLocalDate(anchor, -(windowDays - 1));

  const windowStartUtc = parseLocalDate(windowStart);
  const windowEndExclusive = parseLocalDate(shiftLocalDate(anchor, 1));
  // §30.7 T3-1 — meeting denominator floored at the member's join day so a
  // mid-window joiner's engagement sub-score is not deflated by meetings held
  // before they existed. `null` joinedAt ⇒ unchanged window (byte-identical).
  const meetingFrom = joinedAt
    ? floorMeetingWindowAtJoin(windowStartUtc, joinedAt)
    : windowStartUtc;

  // Parallel fetch — anti-waterfall.
  const [trades, checkins, trainingActivity, meetingActivity] = await Promise.all([
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
        // SPEC §28/§21 — "oublis" axis (discipline). Tri-state Boolean only —
        // the ACT of process-completeness/forgetting, never the trade content.
        processComplete: true,
        // DoD#3 — trade-emotion footprint (emotional stability). String[] tag
        // slugs only — the before/during/after emotional ARC, never the P&L.
        emotionBefore: true,
        emotionDuring: true,
        emotionAfter: true,
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
        // #13 — evening "intention kept" self-report (discipline sub-score).
        intentionKept: true,
        journalNote: true,
        // DoD#3 — morning prep act (discipline) + sleep self-care (engagement).
        marketAnalysisDone: true,
        sleepQuality: true,
        sleepHours: true,
        // SPEC §28/§22 — evening course-adherence act (engagement). A plain
        // check-in boolean — NOT a training-module read (firewall-clean).
        formationFollowed: true,
      },
    }),
    // 🚨 §21.5 — the SINGLE sanctioned training→real-edge touchpoint in
    // scoring. Returns a COUNT only, never a backtest P&L. Same window as the
    // trade/check-in slice so the engagement dimension stays internally
    // coherent. `lte windowEndExclusive` over-includes only the zero-measure
    // instant T00:00:00.000Z of the day after the anchor — immaterial to an
    // effort count (same pragmatic edge-tolerance as the documented
    // habit-trade-correlation "+1j slack").
    countRecentTrainingActivity(userId, windowStartUtc, windowEndExclusive),
    // SPEC §30.4 J-M4 — the Nᵉ Promise.all entry: count-only meeting attendance
    // over the SAME scoring window as the trade/check-in/training slices, so the
    // engagement dimension stays internally coherent (one window drives every
    // sub-score). Returns { scheduledCount, completedCount } integers — feeds the
    // ADDITION-PURE `meetingAttendanceRate` sub-score and nothing else (§30.7).
    // `meetingFrom` floors the window start at the member's join day (T3-1).
    countMeetingAttendance(userId, meetingFrom, windowEndExclusive),
  ]);

  // Map to scoring inputs.
  const disciplineTrades: DisciplineTradeInput[] = trades.map((t) => ({
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    planRespected: t.planRespected,
    hedgeRespected: t.hedgeRespected,
    // SPEC §28/§21 — "oublis" axis. Tri-state passed through verbatim (null →
    // not asked → skipped → byte-identical to pre-§28).
    processComplete: t.processComplete,
  }));

  const disciplineCheckins: DisciplineCheckinInput[] = checkins.map((c) => ({
    slot: c.slot,
    planRespectedToday: c.planRespectedToday,
    morningRoutineCompleted: c.morningRoutineCompleted,
    intention: c.intention,
    // DoD#3 — morning prep act. Tri-state passed through verbatim (null → not
    // asked → skipped → byte-identical to pre-DoD#3).
    marketAnalysisDone: c.marketAnalysisDone,
    // #13 — evening "intention kept" act. Tri-state verbatim (null → not asked
    // → skipped → byte-identical to pre-#13).
    intentionKept: c.intentionKept,
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
      // DoD#3 — trade-emotion footprint. Tag slugs (String[]) only; the
      // negative ones feed the calmer-trading sub-score (SPEC §2 — arc
      // awareness, never P&L). Empty arrays → trade skipped → byte-identical.
      emotionBefore: t.emotionBefore,
      emotionDuring: t.emotionDuring,
      emotionAfter: t.emotionAfter,
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
    // DoD#3 — sleep self-care signal (morning only; null on evening rows /
    // unanswered mornings → skipped → byte-identical to pre-DoD#3).
    sleepQuality: c.sleepQuality,
    // SPEC §28/§22 — evening course-adherence act (null on morning rows /
    // unanswered evenings → skipped → byte-identical to pre-§28).
    formationFollowed: c.formationFollowed,
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
    // 🚨 §21.5 — effort COUNT only (volume/recency feeds engagement; backtest
    // P&L never does). Empty for all 30 V1 members at deploy → training
    // sub-score null → engagement renormalizes to its exact pre-J-T4 value.
    trainingActivityCount: trainingActivity.count,
    // SPEC §30.4 J-M4 — two integer COUNTS (denominator + numerator). When no
    // meeting is scheduled in the window (scheduledCount 0 — every member before
    // the first generate-meetings cron run) the meeting sub-score is skipped →
    // engagement renormalizes to its exact pre-J-M4 value (ADDITION PURE §30.7).
    meetingScheduledCount: meetingActivity.scheduledCount,
    meetingCompletedCount: meetingActivity.completedCount,
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
    // §30.7 T3-1 — joinedAt rides the SAME findMany (no extra query) so each
    // per-user recompute can floor the meeting window without re-hitting the DB.
    select: { id: true, timezone: true, joinedAt: true },
  });

  let computed = 0;
  const skipped = 0;
  let errors = 0;

  // Compute the anchor in each user's TZ — different members may sit in
  // different timezones (V1 default Europe/Paris, but the column exists).
  for (let i = 0; i < users.length; i += batchSize) {
    const slice = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map((u) =>
        recomputeAndPersist(u.id, undefined, {
          ...options,
          timezone: u.timezone,
          joinedAt: u.joinedAt,
        }),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r === undefined) continue;
      if (r.status === 'fulfilled') {
        computed++;
      } else {
        errors++;
        const userId = slice[j]?.id;
        console.error('[scoring] recompute failed:', r.reason);
        // V1.11 — wire to Sentry (was console-only). Per-user recompute failures
        // were invisible in observability dashboard despite the cron audit row
        // surfacing the aggregate count. Round 4 audit P finding.
        reportWarning('scoring.recompute', 'recompute_failed', {
          userId,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
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

/** One point of the behavioral-score trend (4 dimensions over time). Scores are
 *  `null` on days the dimension was `insufficient_data` — never a fabricated 0. */
export interface BehavioralScoreTrendPoint {
  /** Local-day anchor `YYYY-MM-DD`. */
  date: string;
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/**
 * Session 3 §28/§21 — behavioral-score history for the member's "progression
 * over time" chart. The nightly cron persists one `BehavioralScore` per day
 * (upsert on `(userId, date)`); this reads them ascending so the dashboard can
 * draw the 4 dimensions as trend lines. Until this jalon the series was read
 * ONLY by the RGPD export — the member could see today's gauges but never their
 * trajectory. Lightweight projection (4 ints + date), user-scoped, no P&L.
 */
export async function getBehavioralScoreHistory(
  userId: string,
  options: { sinceDays?: number } = {},
): Promise<BehavioralScoreTrendPoint[]> {
  const sinceDays = options.sinceDays ?? 90;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db.behavioralScore.findMany({
    where: { userId, date: { gte: cutoff } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      disciplineScore: true,
      emotionalStabilityScore: true,
      consistencyScore: true,
      engagementScore: true,
    },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    discipline: r.disciplineScore,
    emotionalStability: r.emotionalStabilityScore,
    consistency: r.consistencyScore,
    engagement: r.engagementScore,
  }));
}
