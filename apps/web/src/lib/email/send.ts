import 'server-only';

import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { AnnotationReceivedEmail } from '@/lib/email/templates/annotation-received';
import { InvitationEmail } from '@/lib/email/templates/invitation';
import { WeeklyDigestEmail } from '@/lib/email/templates/weekly-digest';
import type { SerializedWeeklyReport } from '@/lib/weekly-report/types';

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

/** Build the absolute URL to /admin/reports/[id] — used by the J8 weekly digest. */
export function buildAdminReportUrl(reportId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/admin/reports/${encodeURIComponent(reportId)}`;
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

// ----- J8 — weekly digest IA admin -----------------------------------------

export interface SendWeeklyDigestParams {
  to: string;
  memberLabel: string;
  report: SerializedWeeklyReport;
}

/**
 * Send the J8 weekly digest email (SPEC §7.10). Best-effort delivery — the
 * caller (`lib/weekly-report/service.ts`) does NOT roll back the report
 * persistence if email fails; instead it logs an `weekly_report.email.failed`
 * audit row and the cron retries on the next pass.
 *
 * Plain-text fallback follows the same structure as the React Email template
 * so non-HTML clients still get the actionable summary.
 */
export async function sendWeeklyDigestEmail({
  to,
  memberLabel,
  report,
}: SendWeeklyDigestParams): Promise<{ id: string | null; delivered: boolean }> {
  const reportUrl = buildAdminReportUrl(report.id);
  const subject = `Rapport hebdo · ${memberLabel} · ${report.weekStart} → ${report.weekEnd}`;
  const lines: string[] = [];
  lines.push(`Rapport hebdo Fxmily — ${memberLabel}`);
  lines.push(`Période : ${report.weekStart} → ${report.weekEnd}`);
  lines.push('');
  lines.push('Synthèse :');
  lines.push(report.summary);
  lines.push('');
  if (report.risks.length > 0) {
    lines.push('Risques à surveiller :');
    for (const risk of report.risks) lines.push(`- ${risk}`);
    lines.push('');
  }
  lines.push('Recommandations :');
  for (const reco of report.recommendations) lines.push(`- ${reco}`);
  lines.push('');
  const patternEntries: Array<[string, string]> = [];
  if (report.patterns.emotionPerf)
    patternEntries.push(['Émotion × Performance', report.patterns.emotionPerf]);
  if (report.patterns.sleepPerf)
    patternEntries.push(['Sommeil × Performance', report.patterns.sleepPerf]);
  if (report.patterns.sessionFocus)
    patternEntries.push(['Sessions traitées', report.patterns.sessionFocus]);
  if (report.patterns.disciplineTrend)
    patternEntries.push(['Trajectoire discipline', report.patterns.disciplineTrend]);
  if (patternEntries.length > 0) {
    lines.push('Patterns observés :');
    for (const [label, value] of patternEntries) lines.push(`- ${label} : ${value}`);
    lines.push('');
  }
  lines.push(`Ouvre le rapport complet : ${reportUrl}`);
  lines.push('');
  lines.push(
    `Modèle : ${report.claudeModel} · coût : ${Number(report.costEur).toFixed(4)} € · aucun conseil de trade.`,
  );

  const mocked = report.claudeModel.startsWith('mock:');

  return sendEmail({
    to,
    subject,
    react: WeeklyDigestEmail({
      memberLabel,
      weekStartLocal: report.weekStart,
      weekEndLocal: report.weekEnd,
      summary: report.summary,
      risks: report.risks,
      recommendations: report.recommendations,
      patterns: report.patterns,
      reportUrl,
      claudeModel: report.claudeModel,
      costEur: report.costEur,
      mocked,
    }),
    text: lines.join('\n'),
  });
}
