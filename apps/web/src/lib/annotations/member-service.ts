import 'server-only';

import { db } from '@/lib/db';

import { serializeAnnotation, type SerializedAnnotation } from '@/lib/admin/annotations-service';

/**
 * Member-facing annotation service (J4, SPEC §7.8).
 *
 * User-scoped: every read enforces that the requesting user owns the trade
 * the annotations are attached to. The "admin authored it" check is implicit
 * — the row was inserted by an admin and we don't need to re-verify that.
 *
 * Mirrors the trade service split (`lib/trades/service.ts`) — admin-side and
 * member-side stay in separate modules so a stray `userId`-skip on the member
 * path surfaces as a missing import rather than a silent leak.
 */

/**
 * Mark every unread annotation on a trade as read. Returns the number of rows
 * affected. We bulk-update in a single query so opening a trade with N pending
 * corrections is O(1) round-trips regardless of N.
 *
 * Side-effect-free for trades the user does not own — the inner JOIN ensures
 * we don't accidentally flip another member's badges.
 */
export async function markAnnotationsSeenForTrade(
  userId: string,
  tradeId: string,
): Promise<{ count: number }> {
  const now = new Date();
  const result = await db.tradeAnnotation.updateMany({
    where: {
      tradeId,
      seenByMemberAt: null,
      // Inner ownership check: only updates if the trade.userId matches.
      // Using `is` (Prisma relation filter) keeps it in one round-trip.
      trade: { is: { userId } },
    },
    data: { seenByMemberAt: now },
  });
  return { count: result.count };
}

/**
 * List the annotations attached to a trade owned by `userId`. Returns an empty
 * array if the trade does not exist or belongs to another user — never throws,
 * letting the caller treat "no trade" the same as "no annotations" without
 * leaking existence.
 */
export async function listAnnotationsForTradeAsMember(
  userId: string,
  tradeId: string,
): Promise<SerializedAnnotation[]> {
  const rows = await db.tradeAnnotation.findMany({
    where: {
      tradeId,
      // Same inner ownership filter: avoids a separate `findUnique(trade)`
      // round-trip when the user simply doesn't own the trade.
      trade: { is: { userId } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAnnotation);
}

/**
 * Group-by query: how many annotations are unread per trade for this user.
 * Used by the journal list to show a "🆕 N corrections" pill on each card.
 *
 * Returns a `Map` for O(1) lookup; trades with zero unread are simply absent.
 * Indexed by `(tradeId, seenByMemberAt)` so the query stays index-only.
 */
export async function countUnseenAnnotationsByTrade(userId: string): Promise<Map<string, number>> {
  const grouped = await db.tradeAnnotation.groupBy({
    by: ['tradeId'],
    where: {
      seenByMemberAt: null,
      trade: { is: { userId } },
    },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.tradeId, g._count._all]));
}
