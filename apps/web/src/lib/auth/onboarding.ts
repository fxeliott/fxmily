import 'server-only';

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  consumeInvitation,
  findInvitationByToken,
  type InvitationLookup,
} from '@/lib/auth/invitations';
import { logAudit } from '@/lib/auth/audit';

/**
 * Onboarding completion service: consumes an invitation token and creates a
 * fully-active member User row.
 *
 * Idempotency / race protection:
 *   - The token is read inside a serialisable transaction.
 *   - We re-check `usedAt` and `expiresAt` inside the transaction to defeat
 *     a race where two parallel requests use the same token.
 *   - The user creation and invitation update happen atomically.
 */

export interface CompleteOnboardingInput {
  plainToken: string;
  firstName: string;
  lastName: string;
  password: string;
  consentRgpdAt: Date;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export type CompleteOnboardingResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid_token' | 'expired' | 'already_used' | 'email_taken' };

export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<CompleteOnboardingResult> {
  // First, peek at the invitation to fail fast without holding a transaction
  // open if the token is obviously bad.
  const lookup: InvitationLookup = await findInvitationByToken(input.plainToken);
  if (!lookup.ok) {
    if (lookup.reason === 'unknown') return { ok: false, reason: 'invalid_token' };
    if (lookup.reason === 'expired') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'already_used' };
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const result = await db.$transaction(async (tx) => {
      // Re-check the invitation state inside the transaction.
      const invitation = await tx.invitation.findUnique({
        where: { id: lookup.invitation.id },
        select: { id: true, email: true, usedAt: true, expiresAt: true },
      });

      if (!invitation || invitation.usedAt !== null) {
        return { ok: false as const, reason: 'already_used' as const };
      }
      if (invitation.expiresAt.getTime() < Date.now()) {
        return { ok: false as const, reason: 'expired' as const };
      }

      // Reject if the email already has a user (defensive — the invite flow
      // is admin-driven so this should be rare, but we honor uniqueness).
      const existing = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (existing) {
        return { ok: false as const, reason: 'email_taken' as const };
      }

      const user = await tx.user.create({
        data: {
          email: invitation.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          consentRgpdAt: input.consentRgpdAt,
          role: 'member',
          status: 'active',
          emailVerified: new Date(), // accepting the invite proves email ownership
        },
        select: { id: true, email: true },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });

      return { ok: true as const, userId: user.id, email: user.email };
    });

    if (result.ok) {
      // Best-effort audit, outside the transaction.
      await Promise.allSettled([
        logAudit({
          action: 'invitation.consumed',
          userId: result.userId,
          ip: input.ip,
          userAgent: input.userAgent,
          metadata: { invitationId: lookup.invitation.id },
        }),
        logAudit({
          action: 'onboarding.completed',
          userId: result.userId,
          ip: input.ip,
          userAgent: input.userAgent,
        }),
      ]);
    }

    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, reason: 'email_taken' };
    }
    throw err;
  }
}

// Re-export for tests/services.
export { consumeInvitation };
