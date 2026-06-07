'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import {
  AccessRequestNotFoundError,
  AccessRequestNotPendingError,
  AccessRequestUserExistsError,
  approveAccessRequest,
  rejectAccessRequest,
  rollbackApproval,
} from '@/lib/access-request/service';
import { logAudit } from '@/lib/auth/audit';
import { sendAccessApprovedEmail } from '@/lib/email/send';

/**
 * Admin actions for the self-service access-request queue (V2.5).
 *
 * Both actions are admin-gated at the edge (re-call `auth()` + assert
 * `role==='admin'`, mirror `createInvitationAction`'s gate) — defense in depth
 * on top of the `proxy.ts` `/admin/*` gate. The service assumes an admin
 * caller (trust boundary), so the gate lives here.
 *
 * Audit rows are PII-FREE: `{requestId}` only, never the requester's name/email
 * (the `AccessRequest` row holds the PII with its own purge path — mirror
 * `invitation.created` :104-105).
 */
export interface AccessRequestActionState {
  ok: boolean;
  message?: string;
  error?: 'forbidden' | 'not_found' | 'not_pending' | 'user_exists' | 'email_failed' | 'unknown';
}

async function requireAdmin(): Promise<{ id: string } | null> {
  const session = await auth();
  // role AND status==='active' (defense-in-depth, independent of the proxy
  // gate): a demoted/suspended admin holding a still-valid JWT must not be able
  // to mint invitations via the action endpoint. Matches the Server-Action canon
  // (admin/cards, admin/reunions, etc.).
  if (!session?.user || session.user.role !== 'admin' || session.user.status !== 'active') {
    return null;
  }
  return { id: session.user.id };
}

export async function approveAccessRequestAction(
  requestId: string,
): Promise<AccessRequestActionState> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'forbidden', message: 'Accès refusé.' };

  // 1) Mint the invitation + flip the request to approved (transaction).
  let approval;
  try {
    approval = await approveAccessRequest(requestId, admin.id);
  } catch (err) {
    if (err instanceof AccessRequestNotFoundError) {
      return { ok: false, error: 'not_found', message: 'Demande introuvable.' };
    }
    if (err instanceof AccessRequestNotPendingError) {
      return { ok: false, error: 'not_pending', message: 'Cette demande a déjà été traitée.' };
    }
    if (err instanceof AccessRequestUserExistsError) {
      return { ok: false, error: 'user_exists', message: 'Un compte existe déjà pour cet email.' };
    }
    console.error('[access-request] approve transaction failed', err);
    return { ok: false, error: 'unknown', message: 'Impossible de traiter la demande, réessaie.' };
  }

  // 2) Send the premium email. On failure, roll back (delete the invitation +
  //    revert the request to pending) — mirror invite/actions.ts:92-100.
  try {
    await sendAccessApprovedEmail({
      to: approval.email,
      firstName: approval.firstName,
      plainToken: approval.plainToken,
      expiresAt: approval.expiresAt,
    });
  } catch (err) {
    await rollbackApproval(requestId, approval.invitationId).catch(() => undefined);
    console.error('[access-request] approval email failed — rolled back', err);
    return {
      ok: false,
      error: 'email_failed',
      message: "L'envoi de l'email a échoué. La demande reste en attente, réessaie.",
    };
  }

  // 3) Audit (PII-free) + revalidate the queue.
  await logAudit({
    action: 'access_request.approved',
    userId: admin.id,
    metadata: { requestId },
  });

  revalidatePath('/admin/access-requests');
  return { ok: true, message: 'Demande acceptée — email envoyé.' };
}

export async function rejectAccessRequestAction(
  requestId: string,
): Promise<AccessRequestActionState> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'forbidden', message: 'Accès refusé.' };

  try {
    await rejectAccessRequest(requestId, admin.id);
  } catch (err) {
    if (err instanceof AccessRequestNotFoundError) {
      return { ok: false, error: 'not_found', message: 'Demande introuvable.' };
    }
    if (err instanceof AccessRequestNotPendingError) {
      return { ok: false, error: 'not_pending', message: 'Cette demande a déjà été traitée.' };
    }
    console.error('[access-request] reject failed', err);
    return { ok: false, error: 'unknown', message: 'Impossible de traiter la demande, réessaie.' };
  }

  await logAudit({
    action: 'access_request.rejected',
    userId: admin.id,
    metadata: { requestId },
  });

  revalidatePath('/admin/access-requests');
  return { ok: true, message: 'Demande refusée.' };
}
