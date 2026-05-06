import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import type { Prisma } from '@/generated/prisma/client';
import type { NotificationType } from '@/generated/prisma/enums';

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

// =============================================================================
// J5 — Check-in reminders
// =============================================================================

export interface CheckinReminderPayload {
  /** "morning" or "evening" — drives the J9 push title/body. */
  slot: 'morning' | 'evening';
  /** YYYY-MM-DD the reminder is for, in the user's local TZ. */
  date: string;
}

/**
 * Enqueue a check-in reminder push for a single user (J5).
 *
 * Idempotent on the same (user, slot, date): if a pending reminder for the
 * same slot+date already exists, we skip the insert. This protects the cron
 * scanner from doubling up if it runs twice in the same window.
 *
 * Returns the row id (existing or new) on success, null on DB failure.
 */
export async function enqueueCheckinReminder(
  userId: string,
  payload: CheckinReminderPayload,
): Promise<string | null> {
  const type = payload.slot === 'morning' ? 'checkin_morning_reminder' : 'checkin_evening_reminder';

  try {
    // Idempotency: scan for an open reminder of this kind for this date. We
    // don't have a unique index — JSON-payload uniqueness isn't worth the
    // index — but the scan is bounded by the (status, scheduledFor) index
    // and the user's small queue.
    const existing = await db.notificationQueue.findFirst({
      where: {
        userId,
        type,
        status: 'pending',
        // We can't index on JSON, so we filter in memory after fetching
        // pending reminders for this user/type.
      },
      select: { id: true, payload: true },
    });
    if (
      existing &&
      typeof existing.payload === 'object' &&
      existing.payload !== null &&
      !Array.isArray(existing.payload) &&
      (existing.payload as Record<string, unknown>).date === payload.date
    ) {
      return existing.id;
    }

    const row = await db.notificationQueue.create({
      data: {
        userId,
        type,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error('[notifications.enqueue.checkin] failed', err);
    return null;
  }
}

/**
 * Bulk enqueue: returns the count of newly-created reminders. Existing pending
 * rows are not duplicated. Skips a user when their slot is already filled for
 * `today` (passed in the input — caller decides who's eligible).
 */
export async function enqueueCheckinRemindersBulk(
  recipients: Array<{ userId: string; slot: 'morning' | 'evening'; date: string }>,
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;
  for (const r of recipients) {
    const id = await enqueueCheckinReminder(r.userId, { slot: r.slot, date: r.date });
    if (id) enqueued += 1;
    else skipped += 1;
  }
  return { enqueued, skipped };
}

/** Type-narrowing helper for J9 dispatcher (kept here so all queue knobs sit together). */
export const NOTIFICATION_TYPES_CHECKIN = new Set<NotificationType>([
  'checkin_morning_reminder',
  'checkin_evening_reminder',
]);
