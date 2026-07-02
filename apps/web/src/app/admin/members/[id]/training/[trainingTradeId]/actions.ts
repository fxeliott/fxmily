'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import {
  TrainingAnnotationNotFoundError,
  createTrainingAnnotation,
  deleteTrainingAnnotation,
  getTrainingAnnotationById,
} from '@/lib/admin/training-annotation-service';
import { logAudit } from '@/lib/auth/audit';
import { ensureMicroObjectiveFromAnnotation } from '@/lib/coaching/micro-objective';
import { db } from '@/lib/db';
import { sendTrainingAnnotationReceivedEmail } from '@/lib/email/send';
import { enqueueTrainingAnnotationNotification } from '@/lib/notifications/enqueue';
import { trainingAnnotationCreateSchema } from '@/lib/schemas/training-annotation';
import { parseTrainingAnnotationKey, selectStorage } from '@/lib/storage';

/**
 * Server Actions for the admin backtest-correction workflow (V1.2 Mode
 * Entraînement, SPEC §21, J-T3). Carbon mirror of the J4
 * `app/admin/members/[id]/trades/[tradeId]/actions.ts` — same auth+role
 * gate, Zod re-parse, media-key BOLA, parent-ownership check, best-effort
 * notify, audit, revalidate-both-surfaces shape.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5, BLOCKING):
 *   - Audit metadata carries ids/flags ONLY (`trainingAnnotationId`,
 *     `trainingTradeId`, `memberId`, `hasMedia`, `mediaType`) — NEVER the
 *     correction `comment` nor any backtest P&L.
 *   - `revalidatePath` touches ONLY the admin training detail + the member
 *     `/training` surface — NEVER `/journal`, `/dashboard` or any real edge.
 *   - Reads/writes go through `db.trainingTrade` / `db.trainingAnnotation`
 *     only; no `Trade`/`TradeAnnotation` reference.
 *
 * Parity with J4 (S7 DoD#3 — « fonctionne sur le réel ET sur l'entraînement »):
 * like the real-trade flow, this fires an IMMEDIATE best-effort
 * `sendTrainingAnnotationReceivedEmail` in addition to the push enqueue. This
 * closes the gap where a member WITHOUT a push subscription received NO
 * notification at all for a training correction — the J9 dispatcher returns on
 * `no_subscriptions` BEFORE its fallback email, so push-only left that member
 * silent. The immediate email guarantees delivery regardless of push state.
 */

export interface CreateTrainingAnnotationActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'training_trade_not_found' | 'unknown';
  fieldErrors?: Record<string, string>;
  message?: string;
  /** Set on success so the client can clear the Sheet form. */
  trainingAnnotationId?: string;
}

export interface DeleteTrainingAnnotationActionState {
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
 * Create a correction on `trainingTradeId` for member `memberId`. Curried
 * with the URL params via `.bind(null, memberId, trainingTradeId)` so the
 * form receives only the FormData payload.
 */
export async function createTrainingAnnotationAction(
  memberId: string,
  trainingTradeId: string,
  _prev: CreateTrainingAnnotationActionState | null,
  formData: FormData,
): Promise<CreateTrainingAnnotationActionState> {
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
    axis: readNullableString(formData, 'axis'),
  };

  const parsed = trainingAnnotationCreateSchema.safeParse(raw);
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
  const axis = data.axis ?? null;

  // BOLA defence: the media key must point at THIS backtest. Without it an
  // admin (or token leak) could attach an image uploaded under another
  // backtest's prefix. `parseTrainingAnnotationKey` never cross-accepts a
  // real-edge `annotations/` key (statistical isolation §21.5).
  if (mediaKey !== null) {
    try {
      const parsedKey = parseTrainingAnnotationKey(mediaKey);
      if (parsedKey.trainingTradeId !== trainingTradeId) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { mediaKey: 'Le média ne correspond pas à ce backtest.' },
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

  // Confirm the backtest exists and belongs to the declared member. Failing
  // fast on a URL typo surfaces as `training_trade_not_found` rather than a
  // 500 later (mirror of the J4 trade lookup).
  const ttRow = await db.trainingTrade.findUnique({
    where: { id: trainingTradeId },
    select: { userId: true, user: { select: { email: true, firstName: true } } },
  });
  if (!ttRow || ttRow.userId !== memberId) {
    return { ok: false, error: 'training_trade_not_found' };
  }

  let trainingAnnotationId: string;
  try {
    const created = await createTrainingAnnotation({
      trainingTradeId,
      adminId: session.user.id,
      comment: data.comment,
      mediaKey,
      mediaType,
      axis,
    });
    trainingAnnotationId = created.id;
  } catch (err) {
    // Orphan media: the upload landed but the row insert failed. Best-effort
    // delete; log a failed cleanup so a recurring R2 leak is observable
    // (the janitor sweep is a backstop, not a guarantee).
    if (mediaKey !== null) {
      const storage = selectStorage();
      void storage
        .delete(mediaKey)
        .catch((e) =>
          console.error('[admin.trainingAnnotation.create] orphan media cleanup failed', e),
        );
    }
    console.error('[admin.trainingAnnotation.create] db insert failed', err);
    return { ok: false, error: 'unknown' };
  }

  // Best-effort notify — never roll back the correction if it fails. Push is
  // J9-dispatched.
  await enqueueTrainingAnnotationNotification(memberId, {
    trainingAnnotationId,
    trainingTradeId,
    adminId: session.user.id,
    hasMedia: mediaKey !== null,
  });

  // J-AI corrections echo — a backtest correction tagged with a coaching axis
  // seeds a Mark Douglas micro-objective (idempotent, ≤1 open per member).
  // §21.5-safe: the seeder relates ONLY to User (no FK to the training trade or
  // any edge), exactly like the mental alerts. Best-effort, never rolls back.
  if (axis !== null) {
    await ensureMicroObjectiveFromAnnotation(memberId, axis, trainingAnnotationId).catch((err) => {
      console.error('[admin.trainingAnnotation.create] micro-objective seed failed', err);
    });
  }

  // S7 DoD#3 parity with the real-trade flow: immediate best-effort email so a
  // member without a push subscription is still notified (the dispatcher
  // returns on `no_subscriptions` before its fallback). §21.5: training copy,
  // no pair/P&L, /training deep-link only.
  void sendTrainingAnnotationReceivedEmail({
    to: ttRow.user.email,
    recipientFirstName: ttRow.user.firstName,
    trainingTradeId,
  }).catch((err) => {
    console.error('[admin.trainingAnnotation.create] email failed', err);
  });

  // 🚨 §21.5 — PII-free: ids/flags only, NEVER the comment text or P&L.
  await logAudit({
    action: 'admin.training_annotation.created',
    userId: session.user.id,
    metadata: {
      trainingAnnotationId,
      trainingTradeId,
      memberId,
      hasMedia: mediaKey !== null,
      mediaType,
      axis,
    },
  });

  // 🚨 §21.5 — training surfaces ONLY. Never /journal or /dashboard.
  revalidatePath(`/admin/members/${memberId}/training/${trainingTradeId}`);
  revalidatePath(`/training/${trainingTradeId}`);
  revalidatePath('/training');

  return {
    ok: true,
    trainingAnnotationId,
    message: 'Correction envoyée.',
  };
}

/**
 * Delete a correction. Bound action (no `useActionState`) — an admin can
 * remove their own corrections; a different admin's row is refused via the
 * `(id, adminId)` deleteMany filter inside the service.
 */
export async function deleteTrainingAnnotationAction(
  trainingAnnotationId: string,
): Promise<DeleteTrainingAnnotationActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  // Read BEFORE deleting so we can revalidate the right surfaces + clean up
  // media without a second round-trip after the row is gone.
  const annotation = await getTrainingAnnotationById(trainingAnnotationId);
  if (!annotation) {
    return { ok: false, error: 'not_found' };
  }

  // Ownership chain — the member id drives the member-side revalidation path.
  const trainingTrade = await db.trainingTrade.findUnique({
    where: { id: annotation.trainingTradeId },
    select: { userId: true },
  });

  try {
    await deleteTrainingAnnotation(trainingAnnotationId, session.user.id);
  } catch (err) {
    if (err instanceof TrainingAnnotationNotFoundError) {
      return { ok: false, error: 'not_found' };
    }
    console.error('[admin.trainingAnnotation.delete] failed', err);
    return { ok: false, error: 'unknown' };
  }

  if (annotation.mediaKey) {
    const storage = selectStorage();
    void storage.delete(annotation.mediaKey).catch(() => undefined);
  }

  await logAudit({
    action: 'admin.training_annotation.deleted',
    userId: session.user.id,
    metadata: {
      trainingAnnotationId,
      trainingTradeId: annotation.trainingTradeId,
      memberId: trainingTrade?.userId ?? null,
    },
  });

  // 🚨 §21.5 — training surfaces ONLY. The member-facing paths depend only on
  // `annotation.trainingTradeId` (always known), so revalidate them
  // unconditionally; the admin paths need the owner id. Splitting avoids the
  // asymmetry where a (cascade-guaranteed-unreachable) null `trainingTrade`
  // returned ok:true while leaving every surface stale.
  revalidatePath(`/training/${annotation.trainingTradeId}`);
  revalidatePath('/training');
  if (trainingTrade) {
    revalidatePath(`/admin/members/${trainingTrade.userId}/training/${annotation.trainingTradeId}`);
    revalidatePath(`/admin/members/${trainingTrade.userId}`);
  }

  return { ok: true };
}
