'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  AccountDeletionAlreadyRequestedError,
  AccountDeletionNotPendingError,
  cancelAccountDeletion,
  requestAccountDeletion,
} from '@/lib/account/deletion';
import { logAudit } from '@/lib/auth/audit';

/**
 * Server Actions for `/account/delete`.
 *
 * Both actions return `{ ok: true }` on success or `{ ok: false, error }` on
 * a recognised user-facing failure. Unrecognised throws bubble up to the
 * Next.js error boundary (`/account/delete/error.tsx`) — those are real bugs
 * the user can't fix alone.
 *
 * The `requestAccountDeletionAction` accepts a free-form confirmation string
 * because the type-to-confirm UX is the only real anti-impulsivity gate
 * before the 24h grace timer starts. Without the right phrase we never call
 * the service.
 */

const CONFIRMATION_PHRASE = 'SUPPRIMER';

export type RequestActionResult =
  | { ok: true }
  | { ok: false; error: 'unauthorized' | 'bad_confirmation' | 'already_requested' };

export type CancelActionResult =
  | { ok: true }
  | { ok: false; error: 'unauthorized' | 'not_pending' };

export async function requestAccountDeletionAction(
  formData: FormData,
): Promise<RequestActionResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const confirmation = String(formData.get('confirmation') ?? '').trim();
  if (confirmation !== CONFIRMATION_PHRASE) {
    return { ok: false, error: 'bad_confirmation' };
  }

  try {
    const { scheduledAt } = await requestAccountDeletion(session.user.id);
    await logAudit({
      action: 'account.deletion.requested',
      userId: session.user.id,
      metadata: { scheduledAt: scheduledAt.toISOString() },
    });
  } catch (err) {
    if (err instanceof AccountDeletionAlreadyRequestedError) {
      return { ok: false, error: 'already_requested' };
    }
    throw err;
  }

  revalidatePath('/account/delete');
  return { ok: true };
}

export async function cancelAccountDeletionAction(): Promise<CancelActionResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  try {
    await cancelAccountDeletion(session.user.id);
    await logAudit({
      action: 'account.deletion.cancelled',
      userId: session.user.id,
    });
  } catch (err) {
    if (err instanceof AccountDeletionNotPendingError) {
      return { ok: false, error: 'not_pending' };
    }
    throw err;
  }

  revalidatePath('/account/delete');
  return { ok: true };
}

/**
 * `redirectAfterMaterialisation` — sugar wrapper used by the page when the
 * grace window has visibly elapsed and the cron hasn't run yet (rare race).
 * The page can opt to redirect to `/login` and force a fresh auth.
 */
export async function logoutAndRedirect(): Promise<never> {
  redirect('/api/auth/signout?callbackUrl=/legal/privacy');
}
