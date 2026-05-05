'use server';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
} from '@/lib/auth/invitations';
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

  // Atomically: reject if a User already exists, invalidate any still-active
  // invitations for this email (defeats the "two pending tokens for the same
  // email" race vector), then create the new invitation.
  const plainToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  let invitationId: string;
  try {
    const result = await db.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser) return { ok: false as const, reason: 'user_exists' as const };

      // Invalidate any prior unused invitation so only one token is ever
      // active per email at a time.
      await tx.invitation.updateMany({
        where: { email, usedAt: null },
        data: { usedAt: new Date() },
      });

      const created = await tx.invitation.create({
        data: { email, tokenHash, expiresAt, invitedById: session.user.id },
        select: { id: true },
      });
      return { ok: true as const, invitationId: created.id };
    });

    if (!result.ok) {
      return {
        ok: false,
        fieldErrors: { email: 'Un compte existe déjà pour cet email.' },
      };
    }
    invitationId = result.invitationId;
  } catch (err) {
    console.error('[invite] DB transaction failed', err);
    return {
      ok: false,
      message: 'Impossible de créer l’invitation. Réessaie dans un instant.',
    };
  }

  try {
    await sendInvitationEmail({
      to: email,
      plainToken,
      invitedByName: session.user.name,
      expiresAt,
    });
  } catch (err) {
    // The invitation row exists but no email left the building. Hard-delete
    // the row so the admin's next click generates a fresh token instead of
    // a phantom that could be reused if leaked elsewhere.
    await db.invitation.delete({ where: { id: invitationId } }).catch(() => undefined);
    console.error('[invite] email delivery failed', err);
    return {
      ok: false,
      message: "L'envoi de l'email a échoué. Réessaie dans un instant.",
    };
  }

  // RGPD note: email is intentionally NOT stored in audit metadata. The
  // invitation row already carries the email (with TTL + RGPD purge path);
  // logging it again as plaintext PII serves no audit purpose.
  await logAudit({
    action: 'invitation.created',
    userId: session.user.id,
    metadata: { invitationId },
  });

  return {
    ok: true,
    message: `Invitation envoyée à ${email}.`,
  };
}
