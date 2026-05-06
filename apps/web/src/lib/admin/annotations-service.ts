import 'server-only';

import { db } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import type { AnnotationMediaType } from '@/generated/prisma/enums';
import type { TradeAnnotationModel } from '@/generated/prisma/models/TradeAnnotation';

/**
 * Admin-scoped annotation service (J4, SPEC §6.3, §7.8).
 *
 * **Trust boundary** : every function here assumes the caller is an authenticated
 * admin. We do NOT recheck the role inside the service — that's the caller's
 * job. The Server Actions in `app/admin/.../annotations` re-call `auth()` and
 * the proxy gates `/admin/*` upstream.
 *
 * Mirrors the J3 split (`lib/admin/trades-service.ts`) — keeping admin-bypass
 * helpers in their own module makes a stray `userId`-skip on the member side
 * surface as a missing import rather than a silent leak.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateAnnotationInput {
  tradeId: string;
  adminId: string;
  comment: string;
  mediaKey: string | null;
  mediaType: AnnotationMediaType | null;
}

/**
 * JSON-safe view of a `TradeAnnotation`. Date → ISO string. Boolean and string
 * fields are passed through. This is the shape consumed by client components.
 */
export interface SerializedAnnotation {
  id: string;
  tradeId: string;
  adminId: string;
  comment: string;
  mediaKey: string | null;
  mediaType: AnnotationMediaType | null;
  seenByMemberAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True iff `seenByMemberAt` is null (handy for UI sorting/badges). */
  isUnseenByMember: boolean;
}

export class AnnotationNotFoundError extends Error {
  constructor() {
    super('annotation not found');
    this.name = 'AnnotationNotFoundError';
  }
}

// ----- Helpers ----------------------------------------------------------------

/**
 * Map a Prisma row to the JSON-safe view. Exported (test-only) so callers
 * that read annotations through a transaction tx don't have to duplicate it.
 */
export function serializeAnnotation(row: TradeAnnotationModel): SerializedAnnotation {
  return {
    id: row.id,
    tradeId: row.tradeId,
    adminId: row.adminId,
    comment: row.comment,
    mediaKey: row.mediaKey,
    mediaType: row.mediaType,
    seenByMemberAt: row.seenByMemberAt ? row.seenByMemberAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isUnseenByMember: row.seenByMemberAt === null,
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Create a new annotation. The caller is responsible for enqueueing a
 * notification (lib/notifications/enqueue) — keeping the side-effect outside
 * this function lets the test suite assert each piece independently.
 *
 * Throws Prisma errors if the trade or admin user does not exist. The Server
 * Action wraps the call to surface them as `unknown` to the UI.
 */
export async function createAnnotation(
  input: CreateAnnotationInput,
): Promise<SerializedAnnotation> {
  const row = await db.tradeAnnotation.create({
    data: {
      tradeId: input.tradeId,
      adminId: input.adminId,
      comment: input.comment,
      mediaKey: input.mediaKey,
      mediaType: input.mediaType,
    },
  });
  return serializeAnnotation(row);
}

/**
 * List annotations attached to a trade, newest first. Admin-only — the
 * member-facing equivalent lives in `lib/annotations/member-service.ts` and
 * additionally enforces ownership.
 */
export async function listAnnotationsForTrade(tradeId: string): Promise<SerializedAnnotation[]> {
  const rows = await db.tradeAnnotation.findMany({
    where: { tradeId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAnnotation);
}

/**
 * Hard-delete an annotation. We require both the id and the authoring admin's
 * id so a typo on either side surfaces as a `not found` rather than a stray
 * delete. (The route handler will already have re-checked role=admin.)
 *
 * Throws `AnnotationNotFoundError` if no row matched.
 */
export async function deleteAnnotation(id: string, adminId: string): Promise<void> {
  const result = await db.tradeAnnotation.deleteMany({ where: { id, adminId } });
  if (result.count === 0) {
    throw new AnnotationNotFoundError();
  }
}

/**
 * Look up a single annotation by id. Returns null if absent. Admin-only path:
 * the member-facing surface refuses to load arbitrary annotation ids and
 * always reads them via the trade.
 */
export async function getAnnotationById(id: string): Promise<SerializedAnnotation | null> {
  const row = await db.tradeAnnotation.findUnique({ where: { id } });
  return row ? serializeAnnotation(row) : null;
}

/** Trade lookup helper used by the Server Action to confirm the targeted
 * trade really belongs to the declared member before we create the row. */
export async function findTradeOwnerForAnnotation(
  tradeId: string,
): Promise<{ userId: string } | null> {
  return db.trade.findUnique({
    where: { id: tradeId },
    select: { userId: true },
  });
}

/** Internal type alias to keep Prisma-only typings out of public exports. */
export type _CreateInput = Prisma.TradeAnnotationCreateInput;
