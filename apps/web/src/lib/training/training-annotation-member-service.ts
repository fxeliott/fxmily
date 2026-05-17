import 'server-only';

import {
  serializeTrainingAnnotation,
  type SerializedTrainingAnnotation,
} from '@/lib/admin/training-annotation-service';
import { db } from '@/lib/db';

/**
 * Member-facing training-correction service (V1.2 Mode Entraînement, SPEC
 * §21, J-T3). Carbon mirror of `lib/annotations/member-service.ts` (J4) — the
 * member SEES corrections on their backtests (deliberate contrast with the
 * V2.1 AdminNote, which the member never sees: a training correction is a J4
 * coaching artefact, member-visible).
 *
 * User-scoped: every read enforces ownership via the inner relation filter
 * `trainingTrade: { is: { userId } }` — exactly the proven J4 pattern, one
 * round-trip, no separate `findUnique`. A stray `userId`-skip surfaces as a
 * leak in review rather than silently. STATISTICAL ISOLATION (§21.5): touches
 * ONLY `db.trainingAnnotation` scoped through `TrainingTrade.userId` — never
 * `Trade`/`TradeAnnotation` or any real-edge module.
 */

/**
 * Mark every unread correction on a backtest as read, in a single query
 * (O(1) round-trips regardless of N). Side-effect-free for backtests the
 * user does not own — the inner relation filter guarantees we never flip
 * another member's badges. Mirror of `markAnnotationsSeenForTrade`.
 */
export async function markTrainingAnnotationsSeenForTrainingTrade(
  userId: string,
  trainingTradeId: string,
): Promise<{ count: number }> {
  const now = new Date();
  const result = await db.trainingAnnotation.updateMany({
    where: {
      trainingTradeId,
      seenByMemberAt: null,
      trainingTrade: { is: { userId } },
    },
    data: { seenByMemberAt: now },
  });
  return { count: result.count };
}

/**
 * List the corrections on a backtest owned by `userId`, newest-first (mirror
 * of `listAnnotationsForTradeAsMember` — same `createdAt: 'desc'` ordering as
 * J4). Returns an empty array if the backtest does not exist or belongs to
 * another user — never throws, never leaks existence.
 */
export async function listTrainingAnnotationsForTrainingTradeAsMember(
  userId: string,
  trainingTradeId: string,
): Promise<SerializedTrainingAnnotation[]> {
  const rows = await db.trainingAnnotation.findMany({
    where: {
      trainingTradeId,
      trainingTrade: { is: { userId } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeTrainingAnnotation);
}

/**
 * Group-by: unread corrections per backtest for this user. Powers the
 * "N correction(s) reçue(s)" pill on the `/training` list. Returns a `Map`
 * for O(1) lookup; backtests with zero unread are simply absent. Mirror of
 * `countUnseenAnnotationsByTrade` (same `_count: { _all: true }` shape).
 */
export async function countUnseenTrainingAnnotationsByTrainingTrade(
  userId: string,
): Promise<Map<string, number>> {
  const grouped = await db.trainingAnnotation.groupBy({
    by: ['trainingTradeId'],
    where: {
      seenByMemberAt: null,
      trainingTrade: { is: { userId } },
    },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.trainingTradeId, g._count._all]));
}
