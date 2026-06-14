import 'server-only';

import { db } from '@/lib/db';

import { serializeTrainingTrade } from './training-trade-service';
import {
  serializeTrainingSession,
  type SerializedTrainingSession,
  type SerializedTrainingSessionWithTrades,
} from './training-session-service';

/**
 * Admin-scoped backtest-SESSION reads (S8 Mode Entraînement, brief §27 output
 * to Session 7 — the admin supervises a member's practice sittings).
 *
 * EXACT mirror of `training-trade-admin-service.ts`: every read is scoped to
 * the member being viewed, serialization is reused so admin and member views
 * are byte-identical. STATISTICAL ISOLATION (§21.5): touches ONLY
 * `db.trainingSession` / `db.trainingTrade` — never a real-edge model.
 *
 * **Trust boundary**: every function assumes the caller is an authenticated
 * admin. The role is NOT re-checked here — that's the caller's job (the admin
 * detail page re-calls `auth()` + asserts `role === 'admin'`; `proxy.ts` gates
 * `/admin/*` upstream). Keeping these in an admin-only module makes a stray
 * member-side import surface as a missing symbol rather than a silent leak.
 */

/**
 * List every backtest session authored by `memberId`, newest-first by start
 * instant (same order as the member's own `/training` sessions list), each
 * with its live backtest count.
 */
export async function listTrainingSessionsAsAdmin(
  memberId: string,
): Promise<SerializedTrainingSession[]> {
  const rows = await db.trainingSession.findMany({
    where: { memberId },
    orderBy: { startedAt: 'desc' },
    include: { _count: { select: { trades: true } } },
  });
  return rows.map(serializeTrainingSession);
}

/**
 * Read a single session scoped to BOTH its id and the member being viewed, in
 * one query, WITH its backtests (newest-first). `findFirst({ id, memberId })`
 * (V1.9 TIER B canon): an admin on member A's page can never resolve member
 * B's session by crafting its id. Returns null if absent or not owned
 * (caller → 404).
 */
export async function getTrainingSessionWithTradesAsAdmin(
  memberId: string,
  sessionId: string,
): Promise<SerializedTrainingSessionWithTrades | null> {
  const row = await db.trainingSession.findFirst({
    where: { id: sessionId, memberId },
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
