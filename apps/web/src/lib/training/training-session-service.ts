import 'server-only';

import type { TrainingSessionModel } from '@/generated/prisma/models/TrainingSession';

import { db } from '@/lib/db';

import { serializeTrainingTrade, type SerializedTrainingTrade } from './training-trade-service';

/**
 * Member-scoped backtest-SESSION service (S8 Mode Entraînement — "crée une
 * session de backtest", brief §31 DoD#1).
 *
 * A `TrainingSession` groups the `TrainingTrade` entries logged during one
 * practice sitting. Every function is user-scoped: it takes the member id and
 * refuses to read a session that doesn't belong to that member (defence in
 * depth on top of `proxy.ts` + the Server Actions re-calling `auth()`).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5): this module touches ONLY
 * `db.trainingSession` / `db.trainingTrade`. A session never reaches the
 * real-edge surfaces (`/journal`, dashboard, scoring, expectancy,
 * Habit×Trade correlation). The real-edge activity channel stays
 * `countRecentTrainingActivity` (counts BACKTESTS, never sessions) — a session
 * container changes nothing there. Anti-leak `BREACH_TOKENS` pins this.
 *
 * Reads serialise `Date → ISO string` so the value is JSON-safe for client
 * components, exactly like `training-trade-service.ts`.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateTrainingSessionInput {
  userId: string;
  label: string | null;
  symbol: string | null;
  timeframe: string | null;
  notes: string | null;
}

/** JSON-safe view of a `TrainingSession`. `Date → ISO string`; the live
 * backtest count is carried alongside so the list can show "N backtest(s)"
 * without a second round-trip. */
export interface SerializedTrainingSession {
  id: string;
  label: string | null;
  symbol: string | null;
  timeframe: string | null;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Number of backtests currently attached (computed via `_count`). */
  tradeCount: number;
}

/** A session plus the (serialised) backtests logged inside it, newest-first. */
export interface SerializedTrainingSessionWithTrades extends SerializedTrainingSession {
  trades: SerializedTrainingTrade[];
}

// ----- Helpers ----------------------------------------------------------------

/** Map a Prisma row (optionally carrying a `_count.trades`) to the JSON-safe
 * view. `tradeCount` falls back to 0 when the caller didn't request the count. */
export function serializeTrainingSession(
  row: TrainingSessionModel & { _count?: { trades: number } },
): SerializedTrainingSession {
  return {
    id: row.id,
    label: row.label,
    symbol: row.symbol,
    timeframe: row.timeframe,
    notes: row.notes,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt == null ? null : row.endedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tradeCount: row._count?.trades ?? 0,
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Open a backtest session for `input.userId`. All context fields are optional
 * (a member may open a session with just a label). `startedAt` defaults to now
 * at the DB layer.
 */
export async function createTrainingSession(
  input: CreateTrainingSessionInput,
): Promise<SerializedTrainingSession> {
  const row = await db.trainingSession.create({
    data: {
      memberId: input.userId,
      label: input.label,
      symbol: input.symbol,
      timeframe: input.timeframe,
      notes: input.notes,
    },
  });
  return serializeTrainingSession(row);
}

/**
 * List every session for `userId`, newest-first by start instant (matches the
 * `(memberId, startedAt DESC)` index). Each row carries its live backtest
 * count via `_count` so the landing can render "N backtest(s)" cheaply.
 */
export async function listTrainingSessionsForUser(
  userId: string,
): Promise<SerializedTrainingSession[]> {
  const rows = await db.trainingSession.findMany({
    where: { memberId: userId },
    orderBy: { startedAt: 'desc' },
    include: { _count: { select: { trades: true } } },
  });
  return rows.map(serializeTrainingSession);
}

/**
 * Read a single session scoped to its owner in ONE query, WITH its backtests
 * (newest-first). `findFirst({ id, memberId })` (V1.9 TIER B canon: single
 * SQL, no timing oracle). Returns null if absent or not owned (caller → 404).
 */
export async function getTrainingSessionWithTradesById(
  id: string,
  userId: string,
): Promise<SerializedTrainingSessionWithTrades | null> {
  const row = await db.trainingSession.findFirst({
    where: { id, memberId: userId },
    include: {
      _count: { select: { trades: true } },
      trades: { orderBy: { enteredAt: 'desc' } },
    },
  });
  if (!row) return null;
  const { trades, ...session } = row;
  return {
    ...serializeTrainingSession(session),
    trades: trades.map(serializeTrainingTrade),
  };
}

/**
 * Light owner-scoped read of a session's identity (id + label + ended flag),
 * WITHOUT pulling its backtests. Used by `/training/new?sessionId=…` to show
 * "Dans la session : …" and to drop a stale/forged param. Returns null if the
 * session is absent or not owned.
 */
export async function getTrainingSessionMeta(
  id: string,
  userId: string,
): Promise<{ id: string; label: string | null; isEnded: boolean } | null> {
  const row = await db.trainingSession.findFirst({
    where: { id, memberId: userId },
    select: { id: true, label: true, endedAt: true },
  });
  return row ? { id: row.id, label: row.label, isEnded: row.endedAt != null } : null;
}

/**
 * Mark a session as ended (set `endedAt = now`) for its owner. Idempotent:
 * `updateMany({ id, memberId })` returns `{ count: 0 }` (not a throw) when the
 * session is absent or not owned — the caller treats 0 as "not found". A
 * re-close simply overwrites `endedAt` (harmless).
 */
export async function endTrainingSession(id: string, userId: string, now: Date): Promise<boolean> {
  const res = await db.trainingSession.updateMany({
    where: { id, memberId: userId },
    data: { endedAt: now },
  });
  return res.count > 0;
}
