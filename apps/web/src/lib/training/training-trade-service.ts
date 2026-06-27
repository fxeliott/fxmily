import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { TrainingOutcome } from '@/generated/prisma/enums';
import type { TrainingTradeModel } from '@/generated/prisma/models/TrainingTrade';

import { db } from '@/lib/db';

/**
 * Member-scoped backtest service (V1.2 Mode Entraînement, SPEC §21).
 *
 * Every function is user-scoped: it takes a `userId` and refuses to read any
 * backtest that doesn't belong to that user (defence in depth — `proxy.ts`
 * gates `/training/*` and the J-T2 Server Actions re-call `auth()`).
 *
 * STATISTICAL ISOLATION (SPEC §21.5): this module touches ONLY
 * `db.trainingTrade`. A backtest never reaches the real-edge surfaces
 * (`/journal`, dashboard, scoring, expectancy, Habit×Trade correlation) —
 * anti-leak tests land in J-T4.
 *
 * Numeric inputs are plain `number`s wrapped in `Prisma.Decimal` on write
 * (exact mirror of `lib/trades/service.ts`); `Decimal` → `string` on read so
 * the value is JSON-safe for client components.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateTrainingTradeInput {
  userId: string;
  pair: string;
  entryScreenshotKey: string;
  plannedRR: number;
  outcome: TrainingOutcome | null;
  resultR: number | null;
  systemRespected: boolean | null;
  /** S8 V2 — process-discipline checklist (brief §33-2). Each item is tri-state
   * (respected / broken / N-A → boolean | null) AND optional: a backtest may be
   * submitted without touching the checklist. The Server Action passes the
   * parsed schema value; `undefined` normalises to `null` on write. These are
   * DISCIPLINE acts, never affect values nor market judgement (§21.2 + garde-fou
   * §2) — `emotionalStateNoted` records the ACT of observing one's state, not
   * the mood itself. */
  planFollowed?: boolean | null | undefined;
  riskDefinedBefore?: boolean | null | undefined;
  emotionalStateNoted?: boolean | null | undefined;
  noImpulsiveDeviation?: boolean | null | undefined;
  lessonLearned: string;
  enteredAt: Date;
  /** Optional parent backtest session (S8 — "crée une session de backtest").
   * The Server Action must have already verified the session belongs to
   * `userId` (BOLA + §21.5). `null` = a standalone backtest (unchanged). */
  sessionId?: string | null;
}

/**
 * JSON-safe view of a `TrainingTrade`. Prisma `Decimal` → `string`,
 * `Date` → ISO string. Booleans / enums pass through.
 */
export interface SerializedTrainingTrade {
  id: string;
  userId: string;
  pair: string;
  entryScreenshotKey: string | null;
  plannedRR: string;
  outcome: TrainingOutcome | null;
  resultR: string | null;
  systemRespected: boolean | null;
  /** S8 V2 — process-discipline checklist (brief §33-2). `null` = unanswered/N-A,
   * `true` = discipline respected, `false` = deviation acknowledged. */
  planFollowed: boolean | null;
  riskDefinedBefore: boolean | null;
  emotionalStateNoted: boolean | null;
  noImpulsiveDeviation: boolean | null;
  lessonLearned: string;
  enteredAt: string;
  createdAt: string;
  updatedAt: string;
  /** Parent backtest session (S8 grouping), or null for a standalone backtest.
   * A training-only id (FK to `TrainingSession`) — never a real-edge identifier;
   * powers the "back to the session" navigation on the member detail view. */
  sessionId: string | null;
}

// ----- Helpers ----------------------------------------------------------------

/** Map a Prisma row to the JSON-safe view. */
export function serializeTrainingTrade(row: TrainingTradeModel): SerializedTrainingTrade {
  return {
    id: row.id,
    userId: row.userId,
    pair: row.pair,
    entryScreenshotKey: row.entryScreenshotKey,
    plannedRR: row.plannedRR.toString(),
    outcome: row.outcome,
    resultR: row.resultR == null ? null : row.resultR.toString(),
    systemRespected: row.systemRespected,
    planFollowed: row.planFollowed,
    riskDefinedBefore: row.riskDefinedBefore,
    emotionalStateNoted: row.emotionalStateNoted,
    noImpulsiveDeviation: row.noImpulsiveDeviation,
    lessonLearned: row.lessonLearned,
    enteredAt: row.enteredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sessionId: row.sessionId ?? null,
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Create a backtest entry for `input.userId`. Throws Prisma errors if the
 * user FK is missing — the J-T2 Server Action wraps the call.
 */
export async function createTrainingTrade(
  input: CreateTrainingTradeInput,
): Promise<SerializedTrainingTrade> {
  const row = await db.trainingTrade.create({
    data: {
      userId: input.userId,
      pair: input.pair,
      entryScreenshotKey: input.entryScreenshotKey,
      plannedRR: new Prisma.Decimal(input.plannedRR),
      outcome: input.outcome,
      resultR: input.resultR == null ? null : new Prisma.Decimal(input.resultR),
      systemRespected: input.systemRespected,
      planFollowed: input.planFollowed ?? null,
      riskDefinedBefore: input.riskDefinedBefore ?? null,
      emotionalStateNoted: input.emotionalStateNoted ?? null,
      noImpulsiveDeviation: input.noImpulsiveDeviation ?? null,
      lessonLearned: input.lessonLearned,
      enteredAt: input.enteredAt,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
  });
  return serializeTrainingTrade(row);
}

export interface ListTrainingTradesOptions {
  /** Page size, clamped to [1, 50]. Defaults to 20. */
  limit?: number;
  /** Opaque cursor = the `id` of the last item of the previous page.
   * `| undefined` explicit for `exactOptionalPropertyTypes` (mirror
   * `ListTradesOptions`), so the page can pass a parsed `cursor` directly. */
  cursor?: string | undefined;
}

export interface ListTrainingTradesResult {
  items: SerializedTrainingTrade[];
  /** `id` to pass as the next `cursor`, or null when the list is exhausted. */
  nextCursor: string | null;
}

/**
 * List a member's backtests, newest-first by entry timestamp, CURSOR-paginated.
 * Mirror of the real `listTradesForUser` and the admin `listTrainingTradesAsAdmin`
 * — the member landing was the ONLY training list still loading the whole
 * history on every render (S8 verification-layer parity fix). The
 * `(userId, enteredAt DESC)` index (SPEC §21.3) plus the `id` tiebreaker keep
 * the page stable: `enteredAt` is member input at minute precision (non-unique),
 * so without the tiebreaker cursor pagination could skip or duplicate backtests
 * whose sort keys collide between two requests.
 *
 * 🚨 §21.5 — still `db.trainingTrade` only; never joins the real edge.
 */
export async function listTrainingTradesForUser(
  userId: string,
  options: ListTrainingTradesOptions = {},
): Promise<ListTrainingTradesResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const rows = await db.trainingTrade.findMany({
    where: { userId },
    orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: items.map(serializeTrainingTrade),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

/**
 * Read a single backtest, scoped to its owner in ONE query. `findFirst`
 * with `{ id, userId }` is preferred over `findUnique + post-check` (V1.9
 * TIER B security canon: single SQL, no timing oracle). Returns null if
 * absent or not owned.
 */
export async function getTrainingTradeById(
  id: string,
  userId: string,
): Promise<SerializedTrainingTrade | null> {
  const row = await db.trainingTrade.findFirst({ where: { id, userId } });
  return row ? serializeTrainingTrade(row) : null;
}

/**
 * Full-history aggregate of a member's backtests, for the `/training` stats bar.
 * SQL aggregates (count + groupBy + avg) so the numbers stay EXACT once the list
 * itself is cursor-paginated — never reduced over a single truncated page.
 *
 * 🚨 §21.5 — TRAINING-ONLY. These figures (incl. the avg `resultR`) are the
 * member's OWN practice stats, shown ONLY on `/training`, where each backtest
 * already surfaces its own R. They NEVER feed a real-edge channel: no sanctioned
 * touchpoint imports this fn — the single training→real bridge stays
 * `countRecentTrainingActivity` (count/recency only, pinned below). Kept ABOVE
 * that primitive on purpose: the anti-leak Block B/I slice the file from
 * `countRecentTrainingActivity` to EOF and forbid `resultR`/`outcome`/`findMany`
 * there, so a P&L-reading aggregate must live before it.
 */
export interface TrainingTradeStats {
  total: number;
  /** Backtests with a decided outcome (win|loss). */
  decidedCount: number;
  winCount: number;
  /** Backtests carrying a result in R. */
  withRCount: number;
  /** Mean result in R over `withRCount`, or null when none is set. */
  avgR: number | null;
  /** Backtests where the system was explicitly kept/broken (non-null). */
  systemDecidedCount: number;
  systemKeptCount: number;
  /** S8 V2 — backtests run with an IRREPROACHABLE process: every one of the
   * four discipline-checklist items (§33-2) explicitly answered "respected".
   * A pure discipline metric (act of following the process), never a P&L or a
   * market judgement (§21.2 + garde-fou §2). Rate = `checklistCleanCount / total`. */
  checklistCleanCount: number;
}

export async function getTrainingTradeStatsForUser(userId: string): Promise<TrainingTradeStats> {
  const [total, byOutcome, rAgg, bySystem, checklistCleanCount] = await Promise.all([
    db.trainingTrade.count({ where: { userId } }),
    db.trainingTrade.groupBy({ by: ['outcome'], where: { userId }, _count: { _all: true } }),
    db.trainingTrade.aggregate({
      where: { userId, resultR: { not: null } },
      _avg: { resultR: true },
      _count: { resultR: true },
    }),
    db.trainingTrade.groupBy({
      by: ['systemRespected'],
      where: { userId },
      _count: { _all: true },
    }),
    // §33-2 discipline metric: all four checklist items explicitly "respected".
    // §21.5 — still db.trainingTrade only; reads no real-edge surface.
    db.trainingTrade.count({
      where: {
        userId,
        planFollowed: true,
        riskDefinedBefore: true,
        emotionalStateNoted: true,
        noImpulsiveDeviation: true,
      },
    }),
  ]);

  const winCount = byOutcome.find((g) => g.outcome === 'win')?._count._all ?? 0;
  const lossCount = byOutcome.find((g) => g.outcome === 'loss')?._count._all ?? 0;
  const systemKeptCount = bySystem.find((g) => g.systemRespected === true)?._count._all ?? 0;
  const systemBrokenCount = bySystem.find((g) => g.systemRespected === false)?._count._all ?? 0;

  return {
    total,
    decidedCount: winCount + lossCount,
    winCount,
    withRCount: rAgg._count.resultR,
    avgR: rAgg._avg.resultR == null ? null : Number(rAgg._avg.resultR),
    systemDecidedCount: systemKeptCount + systemBrokenCount,
    systemKeptCount,
    checklistCleanCount,
  };
}

// ----- §21.5 isolation primitive ---------------------------------------------

/**
 * Aggregated view of a member's recent backtest activity.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5) — `RecentTrainingActivity` is the
 * SINGLE sanctioned shape by which training data reaches a real-edge surface
 * (engagement scoring, the Mark Douglas inactivity trigger, the weekly-report
 * volume line). It carries ONLY a count and a recency timestamp — never a
 * backtest P&L (`resultR` / `outcome` / `plannedRR`). The sanctioned call
 * sites (`lib/scoring/service.ts`, `lib/triggers/engine.ts`,
 * `lib/weekly-report/loader.ts`, `lib/monthly-debrief/loader.ts`,
 * `lib/calendar/service.ts`) import `countRecentTrainingActivity` and NOTHING
 * else from this module. (Their count-only import contract is pinned by the
 * blocking anti-leak suites — `training-isolation` + `calendar-isolation`.)
 */
export interface RecentTrainingActivity {
  /** Backtests with `enteredAt` in the requested window. */
  count: number;
  /** All-time most recent backtest `enteredAt` (ISO), or null if never. */
  lastEnteredAt: string | null;
}

/**
 * Count a member's backtests in `[fromUtc, toUtc?]` and surface the all-time
 * most-recent entry timestamp. Recency is intentionally window-independent so
 * the inactivity trigger can detect a backtest older than the count window.
 *
 * 🚨 §21.5 — this function performs exactly two queries and selects ONLY
 * `COUNT(*)` + `enteredAt`. NEVER add `resultR` / `outcome` / `plannedRR`
 * (nor a `select` on the `count`, nor a `findMany`) here: that would leak
 * backtest P&L into the real edge. `training-trade-service.test.ts` and the
 * blocking anti-leak suite pin this query shape at runtime.
 *
 * Pure of locale logic: callers derive "days since last training" from
 * `lastEnteredAt` with their own timezone/now, mirroring how every scoring /
 * trigger fn keeps clock + tz injectable for deterministic tests.
 */
export async function countRecentTrainingActivity(
  userId: string,
  fromUtc: Date,
  toUtc?: Date,
): Promise<RecentTrainingActivity> {
  const [count, last] = await Promise.all([
    db.trainingTrade.count({
      where: { userId, enteredAt: { gte: fromUtc, ...(toUtc ? { lte: toUtc } : {}) } },
    }),
    db.trainingTrade.findFirst({
      where: { userId },
      orderBy: { enteredAt: 'desc' },
      select: { enteredAt: true },
    }),
  ]);
  return { count, lastEnteredAt: last ? last.enteredAt.toISOString() : null };
}
