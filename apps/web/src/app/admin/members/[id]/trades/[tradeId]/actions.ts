'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import {
  AnnotationNotFoundError,
  createAnnotation,
  deleteAnnotation,
  findTradeOwnerForAnnotation,
  getAnnotationById,
} from '@/lib/admin/annotations-service';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { sendAnnotationReceivedEmail } from '@/lib/email/send';
import { enqueueAnnotationNotification } from '@/lib/notifications/enqueue';
import { annotationCreateSchema } from '@/lib/schemas/annotation';
import { parseAnnotationKey, selectStorage } from '@/lib/storage';

/**
 * Server Actions for the admin annotation workflow (J4, SPEC §7.8).
 *
 * Both actions follow the J1+J2 pattern:
 *   - re-`auth()` at the top + admin role check (defense in depth)
 *   - Zod re-parse of FormData
 *   - return discriminated `ActionState` for `useActionState`
 *   - re-throw `NEXT_REDIRECT` errors so navigation isn't swallowed
 *
 * Side effects on create:
 *   1. INSERT TradeAnnotation
 *   2. INSERT NotificationQueue (J4 enqueue, J9 dispatch)
 *   3. Best-effort email to the trade owner (Resend, dev fallback logs URL)
 *   4. Audit log `admin.annotation.created`
 *   5. revalidatePath both admin and member views
 */

export interface CreateAnnotationActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'trade_not_found' | 'unknown';
  fieldErrors?: Record<string, string>;
  message?: string;
  /** Set on success so the client can clear the Sheet form. */
  annotationId?: string;
}

export interface DeleteAnnotationActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'not_found' | 'unknown';
  message?: string;
}

function flattenFieldErrors(error: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

function readNullableString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Create a new annotation on `tradeId` for member `memberId`.
 *
 * The action is curried with the URL params via `.bind(null, memberId, tradeId)`
 * so the form receives only the FormData payload.
 */
export async function createAnnotationAction(
  memberId: string,
  tradeId: string,
  _prev: CreateAnnotationActionState | null,
  formData: FormData,
): Promise<CreateAnnotationActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const raw = {
    comment: formData.get('comment') ?? '',
    mediaKey: readNullableString(formData, 'mediaKey'),
    mediaType: readNullableString(formData, 'mediaType'),
  };

  const parsed = annotationCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const mediaKey = data.mediaKey ?? null;
  const mediaType = data.mediaType ?? null;

  // BOLA defence: the media key must point at this trade. Without this, an
  // admin (or token leak) could attach an image uploaded under another
  // trade's prefix.
  if (mediaKey !== null) {
    try {
      const parsedKey = parseAnnotationKey(mediaKey);
      if (parsedKey.tradeId !== tradeId) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { mediaKey: 'Le média ne correspond pas à ce trade.' },
        };
      }
    } catch {
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { mediaKey: 'Clé média invalide.' },
      };
    }
  }

  // Confirm the trade exists AND belongs to the declared member. Surfacing
  // a typo in the URL as `trade_not_found` rather than 500-ing later.
  const owner = await findTradeOwnerForAnnotation(tradeId);
  if (!owner || owner.userId !== memberId) {
    return { ok: false, error: 'trade_not_found' };
  }

  // Need the recipient's email + first name for the notification email,
  // plus the trade pair for the subject. Single round-trip query.
  const tradeRow = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      pair: true,
      user: { select: { email: true, firstName: true } },
    },
  });
  if (!tradeRow) {
    // Race: row vanished between findTradeOwnerForAnnotation and now. Treat
    // as not found rather than 500.
    return { ok: false, error: 'trade_not_found' };
  }

  let annotationId: string;
  try {
    const created = await createAnnotation({
      tradeId,
      adminId: session.user.id,
      comment: data.comment,
      mediaKey,
      mediaType,
    });
    annotationId = created.id;
  } catch (err) {
    // Orphan media: the upload landed but the row insert failed. The
    // janitor cron (J10) sweeps unreferenced annotation media.
    if (mediaKey !== null) {
      const storage = selectStorage();
      void storage.delete(mediaKey).catch(() => undefined);
    }
    console.error('[admin.annotation.create] db insert failed', err);
    return { ok: false, error: 'unknown' };
  }

  // Best-effort side effects — never roll back the annotation creation if
  // they fail.
  await enqueueAnnotationNotification(memberId, {
    annotationId,
    tradeId,
    adminId: session.user.id,
    hasMedia: mediaKey !== null,
  });

  void sendAnnotationReceivedEmail({
    to: tradeRow.user.email,
    recipientFirstName: tradeRow.user.firstName,
    adminName: session.user.name,
    tradeId,
    tradePair: tradeRow.pair,
    hasMedia: mediaKey !== null,
  }).catch((err) => {
    console.error('[admin.annotation.create] email failed', err);
  });

  await logAudit({
    action: 'admin.annotation.created',
    userId: session.user.id,
    metadata: {
      annotationId,
      tradeId,
      memberId,
      hasMedia: mediaKey !== null,
      mediaType,
    },
  });

  // Refresh both admin and member surfaces so the Sheet close + member
  // navigation see the new row.
  revalidatePath(`/admin/members/${memberId}/trades/${tradeId}`);
  revalidatePath(`/admin/members/${memberId}`);
  revalidatePath(`/journal/${tradeId}`);
  revalidatePath('/journal');

  return {
    ok: true,
    annotationId,
    message: tradeRow.user.email
      ? `Correction envoyée à ${tradeRow.user.email}.`
      : 'Correction enregistrée.',
  };
}

/**
 * Delete an annotation. Bound action (no `useActionState`) — the admin can
 * remove their own annotations; a different admin's annotation is refused
 * via the `(id, adminId)` deleteMany filter inside the service.
 */
export async function deleteAnnotationAction(
  annotationId: string,
): Promise<DeleteAnnotationActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  // Read the annotation BEFORE deleting so we can revalidate the right
  // surfaces and clean up media without a second round-trip after the row
  // is gone.
  const annotation = await getAnnotationById(annotationId);
  if (!annotation) {
    return { ok: false, error: 'not_found' };
  }

  // Trade ownership chain — needed for the member-side revalidation paths.
  const trade = await db.trade.findUnique({
    where: { id: annotation.tradeId },
    select: { userId: true },
  });

  try {
    await deleteAnnotation(annotationId, session.user.id);
  } catch (err) {
    if (err instanceof AnnotationNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.annotation.delete] failed', err);
    return { ok: false, error: 'unknown' };
  }

  if (annotation.mediaKey) {
    const storage = selectStorage();
    void storage.delete(annotation.mediaKey).catch(() => undefined);
  }

  await logAudit({
    action: 'admin.annotation.deleted',
    userId: session.user.id,
    metadata: {
      annotationId,
      tradeId: annotation.tradeId,
      memberId: trade?.userId ?? null,
    },
  });

  if (trade) {
    revalidatePath(`/admin/members/${trade.userId}/trades/${annotation.tradeId}`);
    revalidatePath(`/admin/members/${trade.userId}`);
    revalidatePath(`/journal/${annotation.tradeId}`);
    revalidatePath('/journal');
  }

  return { ok: true };
}
