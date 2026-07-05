import 'server-only';

import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';
import {
  type SerializedTrade,
  type ListTradesOptions,
  type ListTradesResult,
} from '@/lib/trades/service';
import type { TradeModel } from '@/generated/prisma/models/Trade';

/**
 * Tour 13 — admin trades list result, augmented with a per-trade admin-annotation
 * count so the list can badge each closed row « Commenté » / « À commenter »
 * without reopening every trade. The count is folded from a single
 * `_count: { annotations }` join on the same `findMany` (no N+1, no second read);
 * `SerializedTrade` stays untouched (it is shared with the member-facing surface,
 * which must not carry an admin-only field). Keyed by trade id.
 */
export interface ListMemberTradesAsAdminResult extends ListTradesResult {
  /** Map<tradeId, admin-annotation count>. A trade absent from the map has 0. */
  annotationCountByTrade: Map<string, number>;
}

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

function toSerialized(
  trade: TradeModel,
  media?: ReadonlyArray<{ id: string; kind: string; fileKey: string; createdAt: Date }>,
): SerializedTrade {
  // Duplicated from lib/trades/service.ts on purpose: the service-private
  // mapper is not exported, and re-exporting it would couple the two scopes.
  // The two views must stay shape-compatible — that contract is enforced by
  // the SerializedTrade interface, not by code reuse.
  const storage = selectStorage();
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
    // V1.5 — Steenbarger setup quality + Tharp risk %.
    tradeQuality: trade.tradeQuality,
    riskPct: trade.riskPct == null ? null : trade.riskPct.toString(),
    emotionBefore: [...trade.emotionBefore],
    planRespected: trade.planRespected,
    hedgeRespected: trade.hedgeRespected,
    processComplete: trade.processComplete,
    slPerRule: trade.slPerRule,
    movedToBe: trade.movedToBe,
    partialAtTarget: trade.partialAtTarget,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    tradingViewEntryUrl: trade.tradingViewEntryUrl,
    tradingViewEntryNote: trade.tradingViewEntryNote,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    exitReason: trade.exitReason,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    emotionDuring: [...trade.emotionDuring],
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    tradingViewExitUrl: trade.tradingViewExitUrl,
    tradingViewExitNote: trade.tradingViewExitNote,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
    // §31 — the admin must see the member's additional analysis photos (the
    // whole point of the trade-review surface, §22 "l'admin voit tout").
    media: (media ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      readUrl: storage.getReadUrl(m.fileKey),
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * List a member's trades for the admin "Trades" tab — cursor-paginated.
 *
 * Mirrors the member-facing `listTradesForUser` exactly: same 50/page size,
 * same `[enteredAt desc, id desc]` tiebreaker (S4 review finding — `enteredAt`
 * is minute-precision member input, non-unique, so the `id` tiebreaker stops
 * the cursor from skipping/duplicating colliding rows), and the same
 * `take: limit + 1` look-ahead to compute `nextCursor`.
 *
 * S7 requires the admin to reach and comment EVERY trade. The previous J3
 * implementation hard-capped at 100 with no pagination UI, so on any member
 * with >100 trades the oldest were silently undiscoverable to the admin while
 * the member could already page through their full history. This restores
 * parity.
 */
export async function listMemberTradesAsAdmin(
  memberId: string,
  options: ListTradesOptions = {},
): Promise<ListMemberTradesAsAdminResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 50));
  const status = options.status ?? 'all';
  const trades = await db.trade.findMany({
    where: {
      userId: memberId,
      ...(status === 'open' ? { closedAt: null } : {}),
      ...(status === 'closed' ? { closedAt: { not: null } } : {}),
    },
    orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    // Tour 13 — fold the admin-annotation count into the SAME query (one join,
    // no N+1) so the list can badge each closed row « Commenté » / « À commenter »
    // without a per-trade read. `_count` returns a plain number per row.
    include: { _count: { select: { annotations: true } } },
  });
  const hasMore = trades.length > limit;
  const items = hasMore ? trades.slice(0, limit) : trades;
  const annotationCountByTrade = new Map<string, number>();
  for (const t of items) {
    annotationCountByTrade.set(t.id, t._count.annotations);
  }
  return {
    // not `.map(toSerialized)` — `.map` passes the index as the media arg.
    items: items.map((t) => toSerialized(t)),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    annotationCountByTrade,
  };
}

export async function getMemberTradeAsAdmin(
  memberId: string,
  tradeId: string,
): Promise<SerializedTrade | null> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    include: {
      media: {
        select: { id: true, kind: true, fileKey: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  // Belt-and-braces: even with admin role we still scope the lookup to the
  // declared `memberId` so a typo in the URL surfaces as 404, never as
  // "another member's trade leaks into this admin view".
  if (!trade || trade.userId !== memberId) return null;
  return toSerialized(trade, trade.media);
}
