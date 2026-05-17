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
  lessonLearned: string;
  enteredAt: Date;
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
  lessonLearned: string;
  enteredAt: string;
  createdAt: string;
  updatedAt: string;
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
    lessonLearned: row.lessonLearned,
    enteredAt: row.enteredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
      lessonLearned: input.lessonLearned,
      enteredAt: input.enteredAt,
    },
  });
  return serializeTrainingTrade(row);
}

/**
 * List every backtest for `userId`, newest-first by entry timestamp
 * (matches the `(userId, enteredAt DESC)` index, SPEC §21.3).
 */
export async function listTrainingTradesForUser(
  userId: string,
): Promise<SerializedTrainingTrade[]> {
  const rows = await db.trainingTrade.findMany({
    where: { userId },
    orderBy: { enteredAt: 'desc' },
  });
  return rows.map(serializeTrainingTrade);
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

// ----- §21.5 isolation primitive ---------------------------------------------

/**
 * Aggregated view of a member's recent backtest activity.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5) — `RecentTrainingActivity` is the
 * SINGLE sanctioned shape by which training data reaches a real-edge surface
 * (engagement scoring, the Mark Douglas inactivity trigger, the weekly-report
 * volume line). It carries ONLY a count and a recency timestamp — never a
 * backtest P&L (`resultR` / `outcome` / `plannedRR`). The three call sites
 * (`lib/scoring/service.ts`, `lib/triggers/engine.ts`,
 * `lib/weekly-report/loader.ts`) import `countRecentTrainingActivity` and
 * NOTHING else from this module.
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
