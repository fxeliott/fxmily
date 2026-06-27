import 'server-only';

import type { TrainingAnnotationMediaType } from '@/generated/prisma/enums';
import type { TrainingAnnotationModel } from '@/generated/prisma/models/TrainingAnnotation';

import { db } from '@/lib/db';

/**
 * Admin-scoped training-correction service (V1.2 Mode Entraînement, SPEC §21).
 *
 * EXACT mirror of `lib/admin/annotations-service.ts` (J4) but for the
 * training isolation surface — corrections attach to a `TrainingTrade`,
 * never a real `Trade`.
 *
 * **Trust boundary**: every function assumes the caller is an authenticated
 * admin. The role is NOT re-checked here — that's the caller's job (the
 * J-T3 Server Actions re-call `auth()` + assert `role === 'admin'`, and
 * `proxy.ts` gates `/admin/*` upstream). Keeping the helpers in an
 * admin-only module makes a stray member-side import surface as a missing
 * symbol rather than a silent leak (mirror of the J3/J4 split).
 *
 * The member-facing read + seen-marking (mirror
 * `lib/annotations/member-service.ts`) deliberately live elsewhere and land
 * in J-T3.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateTrainingAnnotationInput {
  trainingTradeId: string;
  adminId: string;
  comment: string;
  mediaKey: string | null;
  mediaType: TrainingAnnotationMediaType | null;
}

/**
 * JSON-safe view of a `TrainingAnnotation`. Date → ISO string. Booleans /
 * strings pass through. Shape consumed by client components.
 */
export interface SerializedTrainingAnnotation {
  id: string;
  trainingTradeId: string;
  adminId: string;
  comment: string;
  mediaKey: string | null;
  mediaType: TrainingAnnotationMediaType | null;
  seenByMemberAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True iff `seenByMemberAt` is null (handy for UI badges). */
  isUnseenByMember: boolean;
  /** S8 V2 — the member's reply to this correction (brief §32-4), or null if
   * the member has not answered yet. Hardened free text (Trojan-Source canon),
   * psychology/process register only (garde-fou §2). */
  memberReply: string | null;
  /** ISO timestamp of the member reply, or null. */
  memberRepliedAt: string | null;
}

export class TrainingAnnotationNotFoundError extends Error {
  constructor() {
    super('training annotation not found');
    this.name = 'TrainingAnnotationNotFoundError';
  }
}

// ----- Helpers ----------------------------------------------------------------

/** Map a Prisma row to the JSON-safe view. */
export function serializeTrainingAnnotation(
  row: TrainingAnnotationModel,
): SerializedTrainingAnnotation {
  return {
    id: row.id,
    trainingTradeId: row.trainingTradeId,
    adminId: row.adminId,
    comment: row.comment,
    mediaKey: row.mediaKey,
    mediaType: row.mediaType,
    seenByMemberAt: row.seenByMemberAt ? row.seenByMemberAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isUnseenByMember: row.seenByMemberAt === null,
    memberReply: row.memberReply,
    memberRepliedAt: row.memberRepliedAt ? row.memberRepliedAt.toISOString() : null,
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Create a training correction. The caller is responsible for enqueueing the
 * member notification (J-T3) — keeping the side-effect outside lets the test
 * suite assert each piece independently (mirror of `createAnnotation`).
 *
 * Throws Prisma errors if the training trade or admin user does not exist.
 */
export async function createTrainingAnnotation(
  input: CreateTrainingAnnotationInput,
): Promise<SerializedTrainingAnnotation> {
  const row = await db.trainingAnnotation.create({
    data: {
      trainingTradeId: input.trainingTradeId,
      adminId: input.adminId,
      comment: input.comment,
      mediaKey: input.mediaKey,
      mediaType: input.mediaType,
    },
  });
  return serializeTrainingAnnotation(row);
}

/**
 * List corrections attached to a backtest, newest-first. Admin-only — the
 * member-facing equivalent lives in the J-T3 member-service and additionally
 * enforces ownership.
 */
export async function listTrainingAnnotationsForTrainingTrade(
  trainingTradeId: string,
): Promise<SerializedTrainingAnnotation[]> {
  const rows = await db.trainingAnnotation.findMany({
    where: { trainingTradeId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeTrainingAnnotation);
}

/**
 * Hard-delete a correction. Requires both the id and the authoring admin's
 * id so a typo on either side surfaces as `not found` rather than a stray
 * delete (mirror of `deleteAnnotation`). The caller has re-checked role=admin.
 *
 * Throws `TrainingAnnotationNotFoundError` if no row matched.
 */
export async function deleteTrainingAnnotation(id: string, adminId: string): Promise<void> {
  const result = await db.trainingAnnotation.deleteMany({ where: { id, adminId } });
  if (result.count === 0) {
    throw new TrainingAnnotationNotFoundError();
  }
}

/**
 * Look up a single correction by id. Returns null if absent. Admin-only
 * path — used by the J-T3 delete Server Action to resolve the parent
 * trade for revalidation before the row is gone.
 */
export async function getTrainingAnnotationById(
  id: string,
): Promise<SerializedTrainingAnnotation | null> {
  const row = await db.trainingAnnotation.findUnique({ where: { id } });
  return row ? serializeTrainingAnnotation(row) : null;
}

/**
 * S8 admin triage — total corrections per backtest for `memberId`, as a `Map`
 * for O(1) lookup (backtests with zero corrections are simply absent). Powers
 * the "N correction(s)" / "À corriger" badge on the admin training list so the
 * admin can prioritise which backtests still need a correction WITHOUT opening
 * each one (audit S8 d2). Scoped through the parent `TrainingTrade.userId`
 * relation — never another member's data. §21.5-safe: count-only, training
 * surface only, no P&L.
 */
export async function countTrainingAnnotationsByMember(
  memberId: string,
): Promise<Map<string, number>> {
  const grouped = await db.trainingAnnotation.groupBy({
    by: ['trainingTradeId'],
    where: { trainingTrade: { is: { userId: memberId } } },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.trainingTradeId, g._count._all]));
}
