import 'server-only';

import { db } from '@/lib/db';

import { serializeTrainingTrade, type SerializedTrainingTrade } from './training-trade-service';

/**
 * Admin-scoped backtest reads (V1.2 Mode Entraînement, SPEC §21, J-T3).
 *
 * EXACT mirror of the J3/J4 admin-read split (`lib/admin/trades-service.ts`)
 * but on the training isolation surface. STATISTICAL ISOLATION (§21.5): every
 * read touches ONLY `db.trainingTrade` — never `Trade`, scoring, expectancy
 * or any real-edge module. Serialization is reused from the J-T1 member
 * service so the admin and member views are byte-identical.
 *
 * **Trust boundary**: every function assumes the caller is an authenticated
 * admin. The role is NOT re-checked here — that's the caller's job (the J-T3
 * Server Actions + the admin detail page re-call `auth()` + assert
 * `role === 'admin'`; `proxy.ts` gates `/admin/*` upstream). Keeping these in
 * an admin-only module makes a stray member-side import surface as a missing
 * symbol rather than a silent leak (mirror of the J3/J4 split).
 */

/**
 * List every backtest authored by `memberId`, newest-first by entry instant
 * (matches the `(userId, enteredAt DESC)` index — same order as the member's
 * own `/training` list).
 */
export async function listTrainingTradesAsAdmin(
  memberId: string,
): Promise<SerializedTrainingTrade[]> {
  const rows = await db.trainingTrade.findMany({
    where: { userId: memberId },
    orderBy: { enteredAt: 'desc' },
  });
  return rows.map(serializeTrainingTrade);
}

/**
 * Read a single backtest scoped to BOTH its id and the member being viewed,
 * in one query. `findFirst({ id, userId: memberId })` (V1.9 TIER B canon,
 * same as the J-T1 member `getTrainingTradeById`): an admin can never resolve
 * a backtest that does not belong to the member whose page they are on —
 * prevents an admin on member A's page from crafting member B's trade id.
 * Returns null if absent or not owned (caller → 404).
 */
export async function getTrainingTradeAsAdmin(
  memberId: string,
  trainingTradeId: string,
): Promise<SerializedTrainingTrade | null> {
  const row = await db.trainingTrade.findFirst({
    where: { id: trainingTradeId, userId: memberId },
  });
  return row ? serializeTrainingTrade(row) : null;
}
