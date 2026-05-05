import 'server-only';

import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { InvitationEmail } from '@/lib/email/templates/invitation';

/**
 * High-level email helpers — one function per concrete email the app sends.
 * Keeps callers (route handlers, services) free of template/copy concerns.
 */

export interface SendInvitationParams {
  to: string;
  plainToken: string;
  invitedByName: string | null | undefined;
  expiresAt: Date;
}

export async function sendInvitationEmail({
  to,
  plainToken,
  invitedByName,
  expiresAt,
}: SendInvitationParams): Promise<{ id: string | null; delivered: boolean }> {
  const inviteUrl = buildInviteUrl(plainToken);
  const expiresInDays = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return sendEmail({
    to,
    subject: 'Tu es invité·e à rejoindre Fxmily',
    react: InvitationEmail({ inviteUrl, invitedByName, expiresInDays }),
    text: [
      `Bienvenue sur Fxmily.`,
      ``,
      `${invitedByName?.trim() || 'Eliot'} t'a invité·e à rejoindre l'espace de suivi comportemental.`,
      `Active ton compte avec ce lien (expire dans ${expiresInDays} jour${expiresInDays > 1 ? 's' : ''}) :`,
      ``,
      inviteUrl,
      ``,
      `Si tu n'as pas demandé cette invitation, ignore ce message — aucun compte ne sera créé.`,
    ].join('\n'),
  });
}

export function buildInviteUrl(plainToken: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  const token = encodeURIComponent(plainToken);
  return `${base}/onboarding/welcome?token=${token}`;
}
