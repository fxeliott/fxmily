import 'server-only';

import { db } from '@/lib/db';
import type { AnnotationMediaType, TrackingAxis } from '@/generated/prisma/enums';
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
  /** Optional coaching axis (J-AI corrections echo). Omitted/null = untagged. */
  axis?: TrackingAxis | null;
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
  /** Optional coaching axis (J-AI corrections echo). Null = untagged. */
  axis: TrackingAxis | null;
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
    axis: row.axis,
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
      axis: input.axis ?? null,
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

/**
 * Tour 11 (chantier G, FINDING 1) — admin rollup : how many of THIS member's
 * annotations are still unread by them (`seenByMemberAt IS NULL`). The unseen
 * pill already exists per-trade (member journal + trade detail), but the admin
 * had no aggregate : to know if a reframe landed, they had to open every trade.
 * This single indexed count feeds a discreet « N corrections non lues » pill in
 * the member-detail hero.
 *
 * Admin-side mirror of `countUnseenAnnotationsByTrade` (member-service.ts): here
 * we roll up ACROSS trades for one member instead of grouping per trade.
 *
 * Every `TradeAnnotation` is admin-authored by construction (the `adminId` FK +
 * the `AnnotationsAuthored` relation — a member never writes one), so filtering
 * on the member's OWN trades already isolates the admin corrections the member
 * hasn't opened. No author disambiguation is needed.
 *
 * Posture §31.2 : a factual pointer, never a guilt counter. The caller hides the
 * pill entirely at 0 (no « 0 corrections non lues »).
 */
export async function countUnseenAnnotationsByMember(memberId: string): Promise<number> {
  return db.tradeAnnotation.count({
    where: {
      seenByMemberAt: null,
      trade: { is: { userId: memberId } },
    },
  });
}
