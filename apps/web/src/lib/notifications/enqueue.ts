import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Notification queue — enqueue side (J4 enqueue, J9 dispatch).
 *
 * At J4 we persist the *intent* of a push notification. The actual web-push
 * dispatcher (`lib/push/dispatcher.ts`) is built in J9. Until then the row
 * stays `pending` indefinitely — that's fine, the dispatcher will pick it up
 * once wired.
 *
 * Best-effort by design: a failure to enqueue must NOT roll back the
 * operation that triggered it (e.g. creating an annotation). The caller
 * decides whether to await us or fire-and-forget.
 */

export interface AnnotationReceivedPayload {
  /** The annotation that was just created. */
  annotationId: string;
  /** The trade it's attached to — used in the dispatch link. */
  tradeId: string;
  /** Author of the correction — UI mentions "1 correction de Eliot". */
  adminId: string;
  /** Whether the annotation has a media attachment (drives the body copy). */
  hasMedia: boolean;
}

/**
 * Enqueue an "annotation received" push notification for the trade owner.
 *
 * Optionally accepts a Prisma transaction client — when called from inside an
 * existing `db.$transaction(...)`, the enqueue stays atomic with the parent
 * mutation. Without a tx the helper writes through the singleton.
 *
 * Returns the enqueued row's id, or null if the write failed (logged, never
 * thrown).
 */
export async function enqueueAnnotationNotification(
  recipientUserId: string,
  payload: AnnotationReceivedPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'annotation_received',
        // Cast: Prisma's JSON column is `JsonValue` which includes index
        // signatures we don't model on our payload type.
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Audit only outside a transaction — embedding audit in a tx would
    // commit/rollback together with the parent op, which isn't what we want
    // (audit is best-effort, the parent op is the source of truth).
    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'annotation_received',
          tradeId: payload.tradeId,
          annotationId: payload.annotationId,
        },
      });
    }

    return row.id;
  } catch (err) {
    console.error('[notifications.enqueue] failed', err);
    return null;
  }
}
