import 'server-only';

import { db } from '@/lib/db';

import { computePostLossReaction, type PostLossReaction } from './post-loss-reaction';

/**
 * S25 #6 — server seam for the post-loss reaction mirror. Reads the trailing 90
 * days of the member's trades (one indexed `findMany` on `enteredAt`) and hands
 * the rows to the pure {@link computePostLossReaction}. 90 days (vs the mirror's
 * 30) so a member who loses ~1/week still clears the `MIN_LOSSES` floor. No
 * migration: enteredAt/closedAt/outcome already exist.
 */

const LOOKBACK_DAYS = 90;

export async function getPostLossReaction(
  userId: string,
  now: Date = new Date(),
): Promise<PostLossReaction> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.trade.findMany({
    where: { userId, enteredAt: { gte: since } },
    select: { enteredAt: true, closedAt: true, outcome: true },
  });
  return computePostLossReaction(
    rows.map((t) => ({ enteredAt: t.enteredAt, closedAt: t.closedAt, outcome: t.outcome })),
    LOOKBACK_DAYS,
  );
}
