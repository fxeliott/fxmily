import 'server-only';

import { db } from '@/lib/db';
import { type SerializedTrade, type ListTradesOptions } from '@/lib/trades/service';
import type { TradeModel } from '@/generated/prisma/models/Trade';

/**
 * Admin-scoped trades service (J3).
 *
 * Bypass-ownership variant of `lib/trades/service.ts`. Same `SerializedTrade`
 * shape so client components don't need to differentiate. The split is
 * intentional — keeping the two surfaces apart prevents an accidental
 * `userId`-skip in the member-facing path.
 *
 * The caller (route / Server Action) MUST gate the admin role before invoking
 * any function here. `proxy.ts.authorized()` already does it for `/admin/*`,
 * but each entry point also re-checks `session.user.role === 'admin'` as
 * defense in depth.
 */

function toSerialized(trade: TradeModel): SerializedTrade {
  // Duplicated from lib/trades/service.ts on purpose: the service-private
  // mapper is not exported, and re-exporting it would couple the two scopes.
  // The two views must stay shape-compatible — that contract is enforced by
  // the SerializedTrade interface, not by code reuse.
  return {
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
  };
}

/**
 * List a member's trades for the admin "Trades" tab.
 *
 * No pagination cursor for J3 — caps at 100 to keep the page fast on member
 * heavy users. We add a real cursor-paginated UI in J6 once the dashboard
 * needs trend graphs over the full history.
 */
export async function listMemberTradesAsAdmin(
  memberId: string,
  options: Pick<ListTradesOptions, 'status'> = {},
): Promise<SerializedTrade[]> {
  const status = options.status ?? 'all';
  const trades = await db.trade.findMany({
    where: {
      userId: memberId,
      ...(status === 'open' ? { closedAt: null } : {}),
      ...(status === 'closed' ? { closedAt: { not: null } } : {}),
    },
    orderBy: { enteredAt: 'desc' },
    take: 100,
  });
  return trades.map(toSerialized);
}

export async function getMemberTradeAsAdmin(
  memberId: string,
  tradeId: string,
): Promise<SerializedTrade | null> {
  const trade = await db.trade.findUnique({ where: { id: tradeId } });
  // Belt-and-braces: even with admin role we still scope the lookup to the
  // declared `memberId` so a typo in the URL surfaces as 404, never as
  // "another member's trade leaks into this admin view".
  if (!trade || trade.userId !== memberId) return null;
  return toSerialized(trade);
}
