import 'server-only';

import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { AnnotationReceivedEmail } from '@/lib/email/templates/annotation-received';
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

/** Build the absolute URL to the member's trade detail page (/journal/[id]).
 * Used by J4 annotation emails. The route auto-marks annotations as seen. */
export function buildTradeDetailUrl(tradeId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  // Trade ids are CUIDs (alnum); no encodeURIComponent needed but cheap.
  return `${base}/journal/${encodeURIComponent(tradeId)}`;
}

// ----- J4 — annotation received --------------------------------------------

export interface SendAnnotationReceivedParams {
  to: string;
  recipientFirstName: string | null | undefined;
  adminName: string | null | undefined;
  tradeId: string;
  tradePair: string;
  hasMedia: boolean;
}

/**
 * Notify the member that a new annotation has been left on one of their
 * trades (SPEC §7.8). Best-effort: callers should not roll back the
 * annotation creation if email delivery fails.
 */
export async function sendAnnotationReceivedEmail({
  to,
  recipientFirstName,
  adminName,
  tradeId,
  tradePair,
  hasMedia,
}: SendAnnotationReceivedParams): Promise<{ id: string | null; delivered: boolean }> {
  const tradeUrl = buildTradeDetailUrl(tradeId);
  const recipient = recipientFirstName?.trim() || 'Trader';
  const author = adminName?.trim() || 'Eliot';

  return sendEmail({
    to,
    subject: `Nouvelle correction sur ${tradePair}`,
    react: AnnotationReceivedEmail({
      recipientFirstName,
      adminName,
      tradePair,
      hasMedia,
      tradeUrl,
    }),
    text: [
      `Salut ${recipient},`,
      ``,
      `${author} a laissé une correction sur ton trade ${tradePair}.`,
      hasMedia
        ? `Texte + capture annotée à consulter dans ton journal :`
        : `Texte à consulter dans ton journal :`,
      ``,
      tradeUrl,
      ``,
      `La correction est marquée comme lue dès que tu ouvres le trade.`,
    ].join('\n'),
  });
}
