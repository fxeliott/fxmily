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

export interface ListTrainingTradesAsAdminOptions {
  limit?: number;
  cursor?: string | undefined;
}

export interface ListTrainingTradesAsAdminResult {
  items: SerializedTrainingTrade[];
  nextCursor: string | null;
}

/**
 * List a member's backtests for the admin "training" tab — cursor-paginated.
 *
 * Mirrors `listMemberTradesAsAdmin` exactly: same 50/page size, the same
 * `[enteredAt desc, id desc]` tiebreaker (`enteredAt` is minute-precision
 * member input, non-unique — the `id` tiebreaker stops the cursor from
 * skipping/duplicating colliding rows), and the same `take: limit + 1`
 * look-ahead to compute `nextCursor`.
 *
 * S7 requires the admin to reach and correct EVERY backtest. The previous
 * implementation loaded the member's FULL training history in one unbounded
 * `findMany` — on an intensive backtester (training is a high-volume surface
 * by design, §21) the oldest backtests inflated the payload + render with no
 * UI to page through them. This restores parity with the real-trade list.
 * §21.5: every read still touches ONLY `db.trainingTrade`.
 */
export async function listTrainingTradesAsAdmin(
  memberId: string,
  options: ListTrainingTradesAsAdminOptions = {},
): Promise<ListTrainingTradesAsAdminResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 50));
  const rows = await db.trainingTrade.findMany({
    where: { userId: memberId },
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
 * Total backtest count for a member — powers the admin training-list footer
 * ("X au total") so a paginated page is never mistaken for the whole history.
 * §21.5: count-only on `db.trainingTrade`.
 */
export async function countTrainingTradesAsAdmin(memberId: string): Promise<number> {
  return db.trainingTrade.count({ where: { userId: memberId } });
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
