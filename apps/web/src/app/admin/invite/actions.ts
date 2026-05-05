'use server';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { createInvitation } from '@/lib/auth/invitations';
import { logAudit } from '@/lib/auth/audit';
import { sendInvitationEmail } from '@/lib/email/send';
import { inviteSchema } from '@/lib/schemas/auth';

export interface InviteActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: { email?: string };
}

export async function createInvitationAction(
  _prev: InviteActionState | null,
  formData: FormData,
): Promise<InviteActionState> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return { ok: false, message: 'Accès refusé.' };
  }

  const parsed = inviteSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: { email: parsed.error.issues[0]?.message ?? 'Email invalide.' },
    };
  }

  const email = parsed.data.email;

  // Reject if a user already exists for that email — admin should suspend
  // / re-onboard rather than re-invite.
  const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    return {
      ok: false,
      fieldErrors: { email: 'Un compte existe déjà pour cet email.' },
    };
  }

  const { plainToken, expiresAt, invitationId } = await createInvitation({
    email,
    invitedById: session.user.id,
  });

  try {
    await sendInvitationEmail({
      to: email,
      plainToken,
      invitedByName: session.user.name,
      expiresAt,
    });
  } catch (err) {
    // If the email failed, mark the invitation as used so it can't be picked
    // up later (the admin should re-invite, which generates a new token).
    await db.invitation.delete({ where: { id: invitationId } }).catch(() => undefined);
    console.error('[invite] email delivery failed', err);
    return {
      ok: false,
      message: "L'envoi de l'email a échoué. Réessaie dans un instant.",
    };
  }

  await logAudit({
    action: 'invitation.created',
    userId: session.user.id,
    metadata: { invitationId, email },
  });

  return {
    ok: true,
    message: `Invitation envoyée à ${email}.`,
  };
}
