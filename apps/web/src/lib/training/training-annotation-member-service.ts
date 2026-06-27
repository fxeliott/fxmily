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
 * S8 V2 §32-4 — record a member's reply to a backtest correction.
 *
 * Ownership-scoped in the proven J4 shape: the row is read through the inner
 * relation filter `trainingTrade: { is: { userId } }`, so a member can only
 * ever reply to a correction on a backtest they own — a stray id surfaces as
 * `null` (not-found), never another member's correction. STATISTICAL ISOLATION
 * (§21.5): touches ONLY `db.trainingAnnotation` scoped through
 * `TrainingTrade.userId`; reads/writes no real-edge surface.
 *
 * `reply` is the already-validated, hardened free text (the Server Action
 * re-parses `trainingReplyCreateSchema`). Returns the parent ids the action
 * needs to notify the authoring admin + revalidate both surfaces, plus
 * `isFirstReply` so the action notifies ONCE. Returns `null` when the annotation
 * is absent or not owned.
 *
 * `isFirstReply` is claimed ATOMICALLY, not derived from a prior read: the first
 * write filters on `memberRepliedAt: null`, so under two concurrent replies
 * (double-submit / two tabs) the DB lets exactly ONE match (`count === 1` → the
 * first), and the loser falls through to a plain text-only edit (`count === 0`)
 * — no double-ping to the admin, no lost edit. Every write stays owner-scoped
 * (`trainingTrade: { is: { userId } }`), so the mutation can never escape the
 * member's own backtests even if the annotation id is forged.
 */
export interface TrainingReplyResult {
  trainingTradeId: string;
  /** Author of the correction = the admin to notify. */
  adminId: string;
  /** Owner of the backtest = the replying member (drives the admin deep-link). */
  memberId: string;
  /** True iff this is the member's first reply (the row had no prior reply). */
  isFirstReply: boolean;
}

export async function replyToTrainingAnnotationAsMember(
  userId: string,
  trainingAnnotationId: string,
  reply: string,
): Promise<TrainingReplyResult | null> {
  const annotation = await db.trainingAnnotation.findFirst({
    where: { id: trainingAnnotationId, trainingTrade: { is: { userId } } },
    select: { id: true, trainingTradeId: true, adminId: true },
  });
  if (!annotation) return null;

  // Atomic first-reply claim: only the row still lacking a reply matches, so
  // exactly one of N concurrent submits flips `memberRepliedAt` (count === 1).
  const firstClaim = await db.trainingAnnotation.updateMany({
    where: {
      id: annotation.id,
      trainingTrade: { is: { userId } },
      memberRepliedAt: null,
    },
    data: { memberReply: reply, memberRepliedAt: new Date() },
  });

  let isFirstReply = firstClaim.count === 1;
  if (!isFirstReply) {
    // An edit (a reply already exists) or the loser of a concurrent first-reply
    // race: persist the new text WITHOUT re-stamping `memberRepliedAt` (so the
    // admin is not re-notified) — still owner-scoped.
    await db.trainingAnnotation.updateMany({
      where: { id: annotation.id, trainingTrade: { is: { userId } } },
      data: { memberReply: reply },
    });
    isFirstReply = false;
  }

  return {
    trainingTradeId: annotation.trainingTradeId,
    adminId: annotation.adminId,
    memberId: userId,
    isFirstReply,
  };
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
