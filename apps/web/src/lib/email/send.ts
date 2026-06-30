import 'server-only';

import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { AccessApprovedEmail } from '@/lib/email/templates/access-approved';
import { AccessRejectedEmail } from '@/lib/email/templates/access-rejected';
import { AccessRequestReceivedAlertEmail } from '@/lib/email/templates/access-request-received-alert';
import { AnnotationReceivedEmail } from '@/lib/email/templates/annotation-received';
import { CalendarOverdueAlertEmail } from '@/lib/email/templates/calendar-overdue-alert';
import { InvitationEmail } from '@/lib/email/templates/invitation';
import { MonthlyDebriefEmail } from '@/lib/email/templates/monthly-debrief';
import { MonthlyDebriefOverdueAlertEmail } from '@/lib/email/templates/monthly-debrief-overdue-alert';
import { NotificationFallbackEmail } from '@/lib/email/templates/notification-fallback';
import { OnboardingProfileOverdueAlertEmail } from '@/lib/email/templates/onboarding-profile-overdue-alert';
import { PasswordChangedEmail } from '@/lib/email/templates/password-changed';
import { PasswordResetEmail } from '@/lib/email/templates/password-reset';
import { VerificationOverdueAlertEmail } from '@/lib/email/templates/verification-overdue-alert';
import { WeeklyDigestEmail } from '@/lib/email/templates/weekly-digest';
import { WeeklyReportOverdueAlertEmail } from '@/lib/email/templates/weekly-report-overdue-alert';
import { formatMonthLabelFr } from '@/lib/monthly-debrief/format';
import type { SerializedMonthlyDebrief } from '@/lib/monthly-debrief/types';
import type { NotificationTypeSlug } from '@/lib/schemas/push-subscription';
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
      `${invitedByName?.trim() || 'Eliott'} t'a invité·e à rejoindre l'espace de suivi comportemental.`,
      `Active ton compte avec ce lien (expire dans ${expiresInDays} jour${expiresInDays > 1 ? 's' : ''}) :`,
      ``,
      inviteUrl,
      ``,
      `Si tu n'as pas demandé cette invitation, ignore ce message — aucun compte ne sera créé.`,
    ].join('\n'),
  });
}

// ----- "Mot de passe oublié" (SPEC §7.1) -----------------------------------

export interface SendPasswordResetParams {
  to: string;
  plainToken: string;
  firstName: string | null | undefined;
  expiresAt: Date;
}

/**
 * Send the password-reset link. Delivery is NOT best-effort here: the CALLER
 * (`app/forgot-password/actions.ts`) treats a throw as an email failure and
 * deletes the just-minted token (no phantom link), mirroring
 * `invite/actions.ts:92-100` — but it ALWAYS returns the same neutral response
 * to the browser so a delivery failure never reveals whether the email exists.
 */
export async function sendPasswordResetEmail({
  to,
  plainToken,
  firstName,
  expiresAt,
}: SendPasswordResetParams): Promise<{ id: string | null; delivered: boolean }> {
  const resetUrl = buildResetUrl(plainToken);
  const expiresInMinutes = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / (60 * 1000)),
  );

  return sendEmail({
    to,
    subject: 'Réinitialise ton mot de passe Fxmily',
    react: PasswordResetEmail({ resetUrl, firstName, expiresInMinutes }),
    text: [
      `Réinitialisation de ton mot de passe Fxmily.`,
      ``,
      `Tu as demandé à réinitialiser ton mot de passe. Choisis-en un nouveau avec ce lien`,
      `(valable ${expiresInMinutes} minutes, utilisable une seule fois) :`,
      ``,
      resetUrl,
      ``,
      `Si tu n'es pas à l'origine de cette demande, ignore ce message — ton mot de passe actuel reste inchangé.`,
    ].join('\n'),
  });
}

/**
 * Confirm out-of-band that a password reset just COMPLETED (OWASP Forgot
 * Password Cheat Sheet — notify on every credential change so an account
 * takeover is visible immediately). Carries NO token and NO reset link: it is a
 * notification, never an action surface. The only CTA is the recovery path
 * (`/forgot-password`) for the "ce n'était pas toi" case.
 *
 * BEST-EFFORT at the call site (`lib/auth/password-reset.ts:completePassword
 * Reset`): the password is ALREADY rotated and every JWT already revoked by the
 * time this fires, so a delivery failure must never undo a completed reset — the
 * caller swallows any throw.
 */
export async function sendPasswordChangedEmail({
  to,
  firstName,
}: {
  to: string;
  firstName: string | null | undefined;
}): Promise<{ id: string | null; delivered: boolean }> {
  const forgotUrl = buildForgotPasswordUrl();

  return sendEmail({
    to,
    subject: 'Ton mot de passe Fxmily a été modifié',
    react: PasswordChangedEmail({ firstName, forgotUrl }),
    text: [
      `Ton mot de passe Fxmily vient d'être modifié.`,
      ``,
      `Si c'est bien toi, tu n'as rien à faire — connecte-toi avec ton nouveau mot de passe.`,
      `Par sécurité, toutes tes sessions ouvertes ont été déconnectées.`,
      ``,
      `Ce n'était pas toi ? Reprends le contrôle immédiatement : réinitialise ton mot de passe`,
      `(${forgotUrl}) et écris-nous à fxeliott@fxmily.fr pour qu'on bloque l'accès.`,
    ].join('\n'),
  });
}

// ----- V2.5 — access request approved (premium front-door email) -----------

export interface SendAccessApprovedParams {
  to: string;
  firstName: string | null | undefined;
  plainToken: string;
  expiresAt: Date;
}

/**
 * Send the premium "demande acceptée" email after an admin approves a public
 * `/rejoindre` access request (V2.5). REUSES the existing onboarding pipeline:
 * the CTA points at `/onboarding/welcome?token=…` via `buildInviteUrl`, exactly
 * like `sendInvitationEmail` — the account is created by the existing flow, not
 * reinvented.
 *
 * Delivery is NOT best-effort here: the CALLER
 * (`app/admin/access-requests/actions.ts`) treats a throw as an email failure
 * and rolls back (delete the invitation + revert the request to pending),
 * mirroring `invite/actions.ts:92-100`.
 */
export async function sendAccessApprovedEmail({
  to,
  firstName,
  plainToken,
  expiresAt,
}: SendAccessApprovedParams): Promise<{ id: string | null; delivered: boolean }> {
  const inviteUrl = buildInviteUrl(plainToken);
  const expiresInDays = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  const name = firstName?.trim() || null;

  return sendEmail({
    to,
    subject: 'Ta demande est acceptée — bienvenue dans Fxmily',
    react: AccessApprovedEmail({ inviteUrl, firstName, expiresInDays }),
    text: [
      name ? `Salut ${name},` : `Bonjour,`,
      ``,
      `Ta demande pour rejoindre Fxmily est acceptée — bienvenue dans la cohorte.`,
      `Il ne te reste qu'une étape : créer ton compte avec ce lien (expire dans ${expiresInDays} jour${expiresInDays > 1 ? 's' : ''}) :`,
      ``,
      inviteUrl,
      ``,
      `Le lien est unique et ne peut servir qu'une seule fois. Si tu n'es plus intéressé·e, ignore ce message — aucun compte ne sera créé.`,
    ].join('\n'),
  });
}

/**
 * Send the "demande non retenue" email after an admin REJECTS a public
 * `/rejoindre` access request (§26.4 — parcours d'accès complet). Unlike
 * `sendAccessApprovedEmail` (which rolls back on failure), this is BEST-EFFORT
 * at the call site: a rejection is terminal, so an email hiccup must not undo
 * it — the caller (`app/admin/access-requests/actions.ts`) catches + warns.
 * No token, no link: the requester has no further action.
 */
export async function sendAccessRejectedEmail({
  to,
  firstName,
}: {
  to: string;
  firstName: string | null | undefined;
}): Promise<{ id: string | null; delivered: boolean }> {
  const name = firstName?.trim() || null;

  return sendEmail({
    to,
    subject: 'Suite à ta demande d’accès Fxmily',
    react: AccessRejectedEmail({ firstName }),
    text: [
      name ? `Bonjour ${name},` : `Bonjour,`,
      ``,
      `Merci d'avoir fait une demande d'accès à Fxmily. Après examen, nous ne pouvons pas y donner`,
      `suite pour le moment.`,
      ``,
      `Ce n'est pas un jugement sur ton potentiel : la cohorte est privée et le nombre de places est`,
      `volontairement limité pour garder un suivi de qualité.`,
      ``,
      `Une question ? Écris à fxeliott@fxmily.fr.`,
      ``,
      `— L'équipe Fxmily`,
    ].join('\n'),
  });
}

/**
 * Notify the ADMIN that a NEW public access request was created (§26.2 « par
 * EMAIL ET sur son profil admin »). ONLY the operator
 * (`WEEKLY_REPORT_RECIPIENT`) gets it — count-only, ZERO requester PII (name/
 * email live in the `AccessRequest` row with its own purge cron). Best-effort:
 * the caller (`app/rejoindre/actions.ts`) never fails the public request if
 * delivery throws.
 */
export async function sendAccessRequestReceivedAlertEmail({
  to,
  pendingCount,
}: {
  to: string;
  pendingCount: number;
}): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAccessRequestsAdminUrl();
  const plural = pendingCount > 1;

  return sendEmail({
    to,
    subject: `Nouvelle demande d'accès Fxmily · ${pendingCount} en attente`,
    react: AccessRequestReceivedAlertEmail({ pendingCount, adminUrl }),
    text: [
      `Fxmily — nouvelle demande d'accès.`,
      ``,
      `${pendingCount} demande${plural ? 's' : ''} ${plural ? 'sont' : 'est'} en attente de validation dans ta file d'accès.`,
      `Tu peux les accepter ou les refuser depuis ton espace admin.`,
      ``,
      `Ouvre la file : ${adminUrl}`,
      ``,
      `Le détail (prénom, nom, email du demandeur) reste dans l'espace admin, jamais dans cet email.`,
    ].join('\n'),
  });
}

export function buildInviteUrl(plainToken: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  const token = encodeURIComponent(plainToken);
  return `${base}/onboarding/welcome?token=${token}`;
}

/** Build the absolute "mot de passe oublié" reset URL (SPEC §7.1). */
export function buildResetUrl(plainToken: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  const token = encodeURIComponent(plainToken);
  return `${base}/reset-password?token=${token}`;
}

/** Build the absolute "mot de passe oublié" REQUEST URL — the "ce n'était pas
 * toi" recovery CTA in the password-changed confirmation email (SPEC §7.1). */
export function buildForgotPasswordUrl(): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/forgot-password`;
}

/** Build the absolute URL to the admin access-request queue (§26.2 email CTA). */
export function buildAccessRequestsAdminUrl(): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/admin/access-requests`;
}

/** Build the absolute URL to the member's trade detail page (/journal/[id]).
 * Used by J4 annotation emails. The route auto-marks annotations as seen. */
export function buildTradeDetailUrl(tradeId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  // Trade ids are CUIDs (alnum); no encodeURIComponent needed but cheap.
  return `${base}/journal/${encodeURIComponent(tradeId)}`;
}

/** Build the absolute URL to the MEMBER training detail (§21 mode entraînement).
 *  Member-facing — points at /training, NEVER a real-edge surface (§21.5). */
export function buildTrainingTradeDetailUrl(trainingTradeId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/training/${encodeURIComponent(trainingTradeId)}`;
}

/** Build the absolute URL to the ADMIN backtest-correction detail (§21 mode
 *  entraînement, S8 V2 §32-4). Admin-facing — points at the admin member
 *  training surface; still 100% inside the §21.5 training world (no real edge). */
export function buildAdminTrainingTradeUrl(memberId: string, trainingTradeId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/admin/members/${encodeURIComponent(memberId)}/training/${encodeURIComponent(
    trainingTradeId,
  )}`;
}

/** Build the absolute URL to /admin/reports/[id] — used by the J8 weekly digest. */
export function buildAdminReportUrl(reportId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/admin/reports/${encodeURIComponent(reportId)}`;
}

/** Build the absolute URL to the admin dashboard — used by the §26 calendar
 * overdue ops nudge (Session 5). */
export function buildAdminDashboardUrl(): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/admin`;
}

/** Build the absolute URL to the MEMBER monthly debrief page (V1.4 §25).
 * Member-facing — pinned to the exact month via `?id=` (NO admin URL: there
 * is no monthly admin email by design, SPEC §25.2). */
export function buildMemberMonthlyDebriefUrl(debriefId: string): string {
  const base = env.AUTH_URL.replace(/\/+$/, '');
  return `${base}/debrief-mensuel?id=${encodeURIComponent(debriefId)}`;
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
  const author = adminName?.trim() || 'Eliott';

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

// ----- J9 — Web Push fallback after 3 failed dispatch attempts -------------

/// Per-type subject + plain-text intro for the fallback email. Mirrors the
/// `META_BY_TYPE` map inside the React Email template — kept in sync manually
/// (DRY would require a shared module but the duplication is small enough to
/// not warrant the indirection).
const FALLBACK_SUBJECT_BY_TYPE: Record<NotificationTypeSlug, string> = {
  annotation_received: 'Nouvelle correction reçue · Fxmily',
  training_annotation_received: 'Correction reçue (entraînement) · Fxmily',
  checkin_morning_reminder: 'Check-in matin · Fxmily',
  checkin_evening_reminder: 'Check-in soir · Fxmily',
  douglas_card_delivered: 'Nouvelle fiche Mark Douglas · Fxmily',
  weekly_report_ready: 'Rapport hebdo prêt · Fxmily',
  monthly_debrief_ready: 'Ton débrief mensuel est prêt · Fxmily',
  // V1.5 §27.6 dispose "push-only, no email" — defense-in-depth copy if the
  // fallback ever fires (push failed 3× + non-transactional + cap not reached).
  mindset_check_ready: 'Auto-évaluation mindset prête · Fxmily',
  // S3 §33 — push-only (EMAIL_FALLBACK_SKIP_TYPES). Defense-in-depth copy only.
  verification_gentle_reminder: 'Un point rapide sur ton suivi · Fxmily',
  // S8 V2 §32-4 — ADMIN-facing fallback (member replied to a backtest correction).
  training_reply_received: 'Réponse à une correction · Fxmily',
};

const FALLBACK_BODY_BY_TYPE: Record<NotificationTypeSlug, string> = {
  annotation_received:
    "Eliott a laissé une correction sur l'un de tes trades. Elle t'attend dans ton journal — la correction sera marquée comme lue dès que tu ouvres le trade.",
  training_annotation_received:
    "Eliott a laissé une correction sur l'un de tes backtests. Elle t'attend dans ton espace entraînement — marquée comme lue dès que tu ouvres le backtest.",
  checkin_morning_reminder:
    'Trois minutes pour poser ton intention du jour. Pas de rattrapage — si la fenêtre est passée, on se retrouve ce soir.',
  checkin_evening_reminder:
    'Bilan rapide du jour : plan, ressenti, gratitude. Trois minutes pour fermer la journée proprement.',
  douglas_card_delivered:
    'Une fiche est arrivée dans ta bibliothèque, choisie selon ton activité récente. Lis-la quand le moment te paraît juste.',
  weekly_report_ready: 'Ton digest hebdomadaire des membres a été généré.',
  monthly_debrief_ready:
    'Une synthèse du mois écoulé t’attend — progression, trading réel, entraînement. Un moment pour prendre du recul.',
  mindset_check_ready:
    'Ton QCM hebdo de 2 minutes pour mesurer où tu en es — mindset, discipline, patience. Calme et sans pression.',
  verification_gentle_reminder:
    'Un élément de ton suivi est resté de côté. Un coup d’œil quand tu peux — et indique s’il y a une raison. Rien de grave : juste rester honnête avec toi-même.',
  training_reply_received:
    'Un membre a répondu à l’une de tes corrections de backtest. Le détail t’attend dans son espace entraînement, côté admin.',
};

const FALLBACK_CTA_BY_TYPE: Record<NotificationTypeSlug, string> = {
  annotation_received: 'Voir la correction',
  training_annotation_received: 'Voir la correction',
  checkin_morning_reminder: 'Faire le check-in matin',
  checkin_evening_reminder: 'Faire le check-in soir',
  douglas_card_delivered: 'Lire la fiche',
  weekly_report_ready: 'Ouvrir le rapport',
  monthly_debrief_ready: 'Ouvrir mon débrief',
  mindset_check_ready: 'Faire mon QCM hebdo',
  verification_gentle_reminder: 'Voir mon suivi',
  training_reply_received: 'Voir la réponse',
};

export interface SendNotificationFallbackParams {
  to: string;
  recipientFirstName: string | null | undefined;
  type: NotificationTypeSlug;
  /** Absolute URL to the in-app surface (built by caller, e.g. dispatcher). */
  deepUrl: string;
}

/**
 * Email fallback when a Web Push notification has failed all retries
 * (SPEC §18.2 — iOS push fragility mitigation). Best-effort delivery; the
 * caller (`lib/push/dispatcher.ts:dispatchOne`) does NOT roll back the queue
 * row on email failure — it just records `email_attempted` in the audit
 * metadata so admin can spot chronic Resend issues.
 */
export async function sendNotificationFallbackEmail({
  to,
  recipientFirstName,
  type,
  deepUrl,
}: SendNotificationFallbackParams): Promise<{ id: string | null; delivered: boolean }> {
  const recipient = recipientFirstName?.trim() || 'Trader';
  const subject = FALLBACK_SUBJECT_BY_TYPE[type];
  const body = FALLBACK_BODY_BY_TYPE[type];
  const cta = FALLBACK_CTA_BY_TYPE[type];

  return sendEmail({
    to,
    subject,
    react: NotificationFallbackEmail({ recipientFirstName, type, deepUrl }),
    text: [
      `Salut ${recipient},`,
      ``,
      body,
      ``,
      `${cta} : ${deepUrl}`,
      ``,
      `Ce message t'arrive parce qu'une notification push n'a pas pu atteindre`,
      `ton appareil après plusieurs tentatives (Web Push iOS reste fragile en`,
      `2026). Tu peux ajuster les catégories de notification dans ton compte.`,
    ].join('\n'),
  });
}

// ----- S7 — training correction received (immediate, parity with real) -----

export interface SendTrainingAnnotationReceivedParams {
  to: string;
  recipientFirstName: string | null | undefined;
  trainingTradeId: string;
}

/**
 * Notify the member that a correction has been left on one of their backtests
 * (SPEC §21 — S7 DoD#3 parity with the real-trade flow). Immediate +
 * unconditional, exactly like `sendAnnotationReceivedEmail`: closes the gap
 * where a member WITHOUT a push subscription got NO notification at all for a
 * training correction (the dispatcher returns on `no_subscriptions` before its
 * fallback email). Best-effort — the caller never rolls back the correction if
 * delivery fails.
 *
 * §21.5 statistical isolation: reuses the type-driven `training_annotation_
 * received` copy (no pair, no P&L) and points only at /training. Distinct from
 * `sendNotificationFallbackEmail` — no "push failed" caveat, since this is the
 * primary channel, not a fallback.
 */
export async function sendTrainingAnnotationReceivedEmail({
  to,
  recipientFirstName,
  trainingTradeId,
}: SendTrainingAnnotationReceivedParams): Promise<{ id: string | null; delivered: boolean }> {
  const trainingUrl = buildTrainingTradeDetailUrl(trainingTradeId);
  const recipient = recipientFirstName?.trim() || 'Trader';
  const type = 'training_annotation_received' as const;

  return sendEmail({
    to,
    subject: FALLBACK_SUBJECT_BY_TYPE[type],
    react: NotificationFallbackEmail({
      recipientFirstName,
      type,
      deepUrl: trainingUrl,
      channel: 'primary',
    }),
    text: [
      `Salut ${recipient},`,
      ``,
      FALLBACK_BODY_BY_TYPE[type],
      ``,
      `${FALLBACK_CTA_BY_TYPE[type]} : ${trainingUrl}`,
      ``,
      `La correction est marquée comme lue dès que tu ouvres le backtest.`,
    ].join('\n'),
  });
}

// ----- S8 V2 §32-4 — member reply received (immediate, ADMIN-facing) --------

export interface SendTrainingReplyReceivedParams {
  to: string;
  recipientFirstName: string | null | undefined;
  memberId: string;
  trainingTradeId: string;
}

/**
 * Notify the AUTHORING ADMIN that a member replied to one of their backtest
 * corrections (SPEC §21 — S8 V2 §32-4). Immediate + best-effort, the exact
 * mirror of `sendTrainingAnnotationReceivedEmail`: closes the gap where an admin
 * WITHOUT a push subscription got NO notification of the reply (the J9
 * dispatcher returns on `no_subscriptions` before its fallback email). The
 * caller fires it once, on the FIRST reply only (a later edit must not re-ping).
 *
 * §21.5 statistical isolation: reuses the admin-facing `training_reply_received`
 * copy (no pair, no P&L) and deep-links to the ADMIN training surface only —
 * never a real-edge route. RGPD: no member PII in the email body; the member's
 * name lives behind the admin link, never in the message (mirror of the access-
 * request email posture).
 */
export async function sendTrainingReplyReceivedEmail({
  to,
  recipientFirstName,
  memberId,
  trainingTradeId,
}: SendTrainingReplyReceivedParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminTrainingTradeUrl(memberId, trainingTradeId);
  const recipient = recipientFirstName?.trim() || 'Eliott';
  const type = 'training_reply_received' as const;

  return sendEmail({
    to,
    subject: FALLBACK_SUBJECT_BY_TYPE[type],
    react: NotificationFallbackEmail({
      recipientFirstName,
      type,
      deepUrl: adminUrl,
      channel: 'primary',
    }),
    text: [
      `Salut ${recipient},`,
      ``,
      FALLBACK_BODY_BY_TYPE[type],
      ``,
      `${FALLBACK_CTA_BY_TYPE[type]} : ${adminUrl}`,
      ``,
      `Le détail (membre, réponse) reste dans l'espace admin, jamais dans cet email.`,
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

// ----- V1.4 §25 — monthly AI debrief (MEMBER, no admin email) --------------

export interface SendMonthlyDebriefReadyParams {
  to: string;
  recipientFirstName: string | null | undefined;
  debrief: SerializedMonthlyDebrief;
}

/**
 * Send the V1.4 §25 monthly debrief email to the MEMBER (SPEC §25.2 — push
 * + member email; NO monthly admin email). Best-effort: the caller
 * (`lib/monthly-debrief/batch.ts:persistGeneratedReports`) does NOT roll
 * back the persisted debrief if email fails — it records the dispatch state
 * + audit and moves on.
 *
 * Plain-text fallback mirrors the React Email structure (dual-section, the
 * §21.7 boundary stays explicit even in plain text) so non-HTML clients
 * still get an actionable summary.
 */
export async function sendMonthlyDebriefReadyEmail({
  to,
  recipientFirstName,
  debrief,
}: SendMonthlyDebriefReadyParams): Promise<{ id: string | null; delivered: boolean }> {
  const debriefUrl = buildMemberMonthlyDebriefUrl(debrief.id);
  const monthLabel = formatMonthLabelFr(debrief.monthStart);
  const recipient = recipientFirstName?.trim() || 'Trader';
  const subject = `Ton débrief mensuel · ${monthLabel}`;

  const lines: string[] = [];
  lines.push(`Salut ${recipient},`);
  lines.push('');
  lines.push(`Voici ta synthèse Fxmily du mois écoulé — ${monthLabel}.`);
  lines.push('');
  lines.push('Progression :');
  lines.push(debrief.progressionNarrative);
  lines.push('');
  lines.push('Trading réel :');
  lines.push(debrief.summaryReal);
  lines.push('');
  lines.push('Entraînement (régularité/pratique uniquement — pas de P&L) :');
  lines.push(debrief.summaryTraining);
  lines.push('');
  if (debrief.risks.length > 0) {
    lines.push('Points de vigilance :');
    for (const risk of debrief.risks) lines.push(`- ${risk}`);
    lines.push('');
  }
  lines.push('Pistes pour le mois à venir :');
  for (const reco of debrief.recommendations) lines.push(`- ${reco}`);
  lines.push('');
  const patternEntries: Array<[string, string]> = [];
  if (debrief.patterns.monthOverMonth)
    patternEntries.push(['Progression mois sur mois', debrief.patterns.monthOverMonth]);
  if (debrief.patterns.realTrend)
    patternEntries.push(['Tendance trading réel', debrief.patterns.realTrend]);
  if (debrief.patterns.trainingRhythm)
    patternEntries.push(['Rythme d’entraînement', debrief.patterns.trainingRhythm]);
  if (debrief.patterns.disciplineTrend)
    patternEntries.push(['Trajectoire discipline', debrief.patterns.disciplineTrend]);
  if (patternEntries.length > 0) {
    lines.push('Tendances observées :');
    for (const [label, value] of patternEntries) lines.push(`- ${label} : ${value}`);
    lines.push('');
  }
  lines.push(`Ouvre ton débrief : ${debriefUrl}`);
  lines.push('');
  lines.push(
    'Synthèse générée par IA (Claude, Anthropic) — ne remplace ni coaching humain, ni avis médical, ni conseil en investissement. Aucun conseil de trade (SPEC §2).',
  );

  return sendEmail({
    to,
    subject,
    react: MonthlyDebriefEmail({
      recipientFirstName,
      monthLabel,
      progressionNarrative: debrief.progressionNarrative,
      summaryReal: debrief.summaryReal,
      summaryTraining: debrief.summaryTraining,
      risks: debrief.risks,
      recommendations: debrief.recommendations,
      patterns: debrief.patterns,
      debriefUrl,
      claudeModel: debrief.claudeModel,
    }),
    text: lines.join('\n'),
  });
}

// ----- §26 Session 5 — calendar overdue ADMIN nudge (DoD#4 permanence) ------

export interface SendCalendarOverdueAlertParams {
  /** Admin recipient (resolved by the caller from `WEEKLY_REPORT_RECIPIENT`). */
  to: string;
  /** Members with a filled questionnaire but no generated calendar. */
  overdueCount: number;
  /** Total questionnaires submitted this week (context). */
  questionnaireCount: number;
  /** Human FR week range, e.g. "8 juin → 14 juin". */
  weekRange: string;
}

/**
 * Notify the ADMIN that members are waiting on a calendar (Session 5 DoD#4
 * permanence safety-net). ONLY the operator gets this — no member PII, counts
 * only. Best-effort: the caller (`lib/calendar/overdue.ts`) degrades to a
 * Sentry warning + audit if delivery throws, so the alert is never lost.
 */
export async function sendCalendarOverdueAlertEmail({
  to,
  overdueCount,
  questionnaireCount,
  weekRange,
}: SendCalendarOverdueAlertParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminDashboardUrl();
  const plural = overdueCount > 1;
  const subject = `${overdueCount} calendrier${plural ? 's' : ''} en attente · Semaine du ${weekRange}`;

  return sendEmail({
    to,
    subject,
    react: CalendarOverdueAlertEmail({ overdueCount, questionnaireCount, weekRange, adminUrl }),
    text: [
      `Fxmily — rappel de permanence (calendrier adaptatif).`,
      ``,
      `${overdueCount} membre${plural ? 's' : ''} ${plural ? 'ont' : 'a'} rempli le questionnaire`,
      `d'organisation de la semaine du ${weekRange}, mais ${plural ? 'leurs calendriers ne sont' : 'son calendrier n’est'} pas`,
      `encore généré${plural ? 's' : ''} (${overdueCount} en attente sur ${questionnaireCount} organisés).`,
      ``,
      `À faire — depuis ton PC :`,
      `  1. Lance /calendar-batch (ou ops/scripts/calendar-batch-local.sh).`,
      `  2. Claude Opus 4.8 génère les calendriers en local ($0), persistés après les garde-fous §2.`,
      `  3. Les membres voient leur calendrier dès la fin du batch.`,
      ``,
      `Ouvre l'admin : ${adminUrl}`,
      ``,
      `Rappel automatique — envoyé uniquement quand des calendriers sont en attente passé le délai`,
      `de courtoisie. Aucun calendrier n'est généré sur un serveur (le batch reste manuel, par`,
      `sécurité du compte).`,
    ].join('\n'),
  });
}

// ----- §25 Session 5 — monthly debrief overdue ADMIN nudge (DoD#2 permanence) -

export interface SendMonthlyDebriefOverdueAlertParams {
  /** Admin recipient (resolved by the caller from `WEEKLY_REPORT_RECIPIENT`). */
  to: string;
  /** Active members with no monthly debrief for the completed month. */
  overdueCount: number;
  /** Active members expected a debrief for the month (joined ≤ month end). */
  expectedCount: number;
  /** Human FR month label, e.g. "mai 2026". */
  monthLabel: string;
}

/**
 * Notify the ADMIN that members are waiting on their monthly debrief (Session 5
 * DoD#2 permanence safety-net). ONLY the operator gets this — no member PII,
 * counts only. Best-effort: the caller (`lib/monthly-debrief/overdue.ts`)
 * degrades to a Sentry warning + audit if delivery throws.
 */
export async function sendMonthlyDebriefOverdueAlertEmail({
  to,
  overdueCount,
  expectedCount,
  monthLabel,
}: SendMonthlyDebriefOverdueAlertParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminDashboardUrl();
  const plural = overdueCount > 1;
  const subject = `${overdueCount} débrief${plural ? 's' : ''} mensuel${plural ? 's' : ''} en attente · ${monthLabel}`;

  return sendEmail({
    to,
    subject,
    react: MonthlyDebriefOverdueAlertEmail({ overdueCount, expectedCount, monthLabel, adminUrl }),
    text: [
      `Fxmily — rappel de permanence (débrief mensuel).`,
      ``,
      `Le mois de ${monthLabel.toLowerCase()} est terminé, mais ${overdueCount} membre${plural ? 's' : ''} actif${plural ? 's' : ''}`,
      `${expectedCount > overdueCount ? `(sur ${expectedCount}) ` : ''}${plural ? "n'ont" : "n'a"} pas encore reçu leur débrief mensuel.`,
      `Chaque membre actif doit en recevoir un (SPEC §25.4).`,
      ``,
      `À faire — depuis ton PC :`,
      `  1. Lance /monthly-batch (ou ops/scripts/monthly-batch-local.sh).`,
      `  2. Claude Opus 4.8 rédige les débriefs en local ($0), persistés après les garde-fous §2.`,
      `  3. Les membres reçoivent leur débrief (push + email) dès la fin du batch.`,
      ``,
      `Ouvre l'admin : ${adminUrl}`,
      ``,
      `Rappel automatique — envoyé uniquement quand des débriefs sont en attente passé le délai`,
      `de courtoisie. Aucun débrief n'est généré sur un serveur (le batch reste manuel, par`,
      `sécurité du compte).`,
    ].join('\n'),
  });
}

// ----- J8 — weekly report overdue ADMIN nudge (digest permanence) -----------

export interface SendWeeklyReportOverdueAlertParams {
  /** Admin recipient (resolved by the caller from `WEEKLY_REPORT_RECIPIENT`). */
  to: string;
  /** Active members with no weekly report for the completed week. */
  overdueCount: number;
  /** Active members expected a report for the week (joined ≤ week end). */
  expectedCount: number;
  /** Human FR week range, e.g. "8 juin → 14 juin". */
  weekRange: string;
}

/**
 * Notify the ADMIN that the weekly digest is missing for the last completed week
 * (J8 permanence safety-net, 4th twin of the calendar/monthly/onboarding
 * nudges). ONLY the operator gets this — no member PII, counts only.
 * Best-effort: the caller (`lib/weekly-report/overdue.ts`) degrades to a Sentry
 * warning + audit if delivery throws.
 */
export async function sendWeeklyReportOverdueAlertEmail({
  to,
  overdueCount,
  expectedCount,
  weekRange,
}: SendWeeklyReportOverdueAlertParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminDashboardUrl();
  const plural = overdueCount > 1;
  const subject = `${overdueCount} rapport${plural ? 's' : ''} hebdo en attente · Semaine du ${weekRange}`;

  return sendEmail({
    to,
    subject,
    react: WeeklyReportOverdueAlertEmail({ overdueCount, expectedCount, weekRange, adminUrl }),
    text: [
      `Fxmily — rappel de permanence (rapport hebdomadaire).`,
      ``,
      `La semaine du ${weekRange} est terminée, mais ${overdueCount} membre${plural ? 's' : ''} actif${plural ? 's' : ''}`,
      `${expectedCount > overdueCount ? `(sur ${expectedCount}) ` : ''}${plural ? "n'ont" : "n'a"} pas encore leur rapport hebdomadaire.`,
      `Le digest n'a pas été généré pour cette semaine.`,
      ``,
      `À faire — depuis ton PC :`,
      `  1. Lance le batch ops/scripts/weekly-batch-local.sh.`,
      `  2. Claude Opus 4.8 rédige les rapports en local ($0), persistés après les garde-fous §2.`,
      `  3. Le digest admin est prêt dès la fin du batch.`,
      ``,
      `Ouvre l'admin : ${adminUrl}`,
      ``,
      `Rappel automatique — envoyé uniquement quand des rapports hebdo sont en attente passé le délai`,
      `de courtoisie. Aucun rapport n'est généré sur un serveur (le batch reste manuel, par`,
      `sécurité du compte).`,
    ].join('\n'),
  });
}

// ----- S2 — onboarding profile overdue ADMIN nudge (profilage permanence) ---

export interface SendOnboardingProfileOverdueAlertParams {
  /** Admin recipient (resolved by the caller from `WEEKLY_REPORT_RECIPIENT`). */
  to: string;
  /** Completed interviews of active members with no MemberProfile past 24h. */
  overdueCount: number;
  /** ISO instant of the oldest overdue completion, or null. PII-free. */
  oldestCompletedAt: string | null;
}

/**
 * FR date label (Europe/Paris) for the oldest overdue interview completion —
 * a bare calendar date, no member identity attached (PII-free invariant).
 */
function formatOldestCompletedFr(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/**
 * Notify the ADMIN that members are waiting on their onboarding profile (S2
 * profilage permanence safety-net, 3rd twin of the calendar/monthly nudges).
 * ONLY the operator gets this — no member PII, counts + a date only.
 * Best-effort: the caller (`lib/onboarding-interview/overdue.ts`) degrades to
 * a Sentry warning + audit if delivery throws.
 */
export async function sendOnboardingProfileOverdueAlertEmail({
  to,
  overdueCount,
  oldestCompletedAt,
}: SendOnboardingProfileOverdueAlertParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminDashboardUrl();
  const plural = overdueCount > 1;
  const oldestLabel = oldestCompletedAt ? formatOldestCompletedFr(oldestCompletedAt) : null;
  const subject = `${overdueCount} profil${plural ? 's' : ''} d'onboarding en attente · promesse 24h dépassée`;

  return sendEmail({
    to,
    subject,
    react: OnboardingProfileOverdueAlertEmail({ overdueCount, oldestLabel, adminUrl }),
    text: [
      `Fxmily — rappel de permanence (profil d'onboarding).`,
      ``,
      `${overdueCount} membre${plural ? 's' : ''} actif${plural ? 's' : ''} ${plural ? 'ont' : 'a'} complété leur entretien d'onboarding`,
      `il y a plus de 24h sans recevoir leur profil${oldestLabel ? ` (le plus ancien attend depuis le ${oldestLabel})` : ''}.`,
      `L'app leur promet leur profil « dans les prochaines 24h ».`,
      ``,
      `À faire — depuis ton PC :`,
      `  1. Lance bash ops/scripts/onboarding-batch-local.sh.`,
      `  2. Le moteur Claude local ($0) synthétise les profils, persistés après les garde-fous §2.`,
      `  3. Les membres voient leur profil dans « Mon profil » dès la fin du batch.`,
      ``,
      `Ouvre l'admin : ${adminUrl}`,
      ``,
      `Rappel automatique — envoyé uniquement quand des profils sont en attente passé le délai`,
      `de courtoisie. Aucun profil n'est généré sur un serveur (le batch reste manuel, par`,
      `sécurité du compte).`,
    ].join('\n'),
  });
}

// ----- AUTONOMY-1 — MT5 proof vision overdue ADMIN nudge (vérif. permanence) -

export interface SendVerificationOverdueAlertParams {
  /** Admin recipient (resolved by the caller from `WEEKLY_REPORT_RECIPIENT`). */
  to: string;
  /** Pending MT5 proofs of active members past the grace window (no batch run). */
  overdueCount: number;
  /** ISO instant of the oldest overdue upload, or null. PII-free. */
  oldestUploadedAt: string | null;
}

/**
 * Notify the ADMIN that members are waiting on their MT5 proof analysis
 * (AUTONOMY-1 vérification permanence safety-net, 5th twin of the
 * calendar/monthly/onboarding/weekly nudges). ONLY the operator gets this —
 * no member PII, counts + a date only. Best-effort: the caller
 * (`lib/verification/overdue.ts`) degrades to a Sentry warning + audit if
 * delivery throws.
 */
export async function sendVerificationOverdueAlertEmail({
  to,
  overdueCount,
  oldestUploadedAt,
}: SendVerificationOverdueAlertParams): Promise<{ id: string | null; delivered: boolean }> {
  const adminUrl = buildAdminDashboardUrl();
  const plural = overdueCount > 1;
  const oldestLabel = oldestUploadedAt ? formatOldestCompletedFr(oldestUploadedAt) : null;
  const subject = `${overdueCount} preuve${plural ? 's' : ''} MT5 en attente d'analyse · vision batch`;

  return sendEmail({
    to,
    subject,
    react: VerificationOverdueAlertEmail({ overdueCount, oldestLabel, adminUrl }),
    text: [
      `Fxmily — rappel de permanence (vérification MT5 / vision).`,
      ``,
      `${overdueCount} membre${plural ? 's' : ''} actif${plural ? 's' : ''} ${plural ? 'ont' : 'a'} envoyé une preuve de compte MT5`,
      `il y a plus de 24h sans qu'elle soit analysée${oldestLabel ? ` (la plus ancienne attend depuis le ${oldestLabel})` : ''}.`,
      `Tant que le batch vision n'est pas lancé, le compte et les positions ne sont jamais extraits.`,
      ``,
      `À faire — depuis ton PC :`,
      `  1. Lance /verification-batch (ou bash ops/scripts/verification-batch-local.sh).`,
      `  2. Le moteur Claude local ($0) lit les preuves et extrait comptes + positions, persistés après les garde-fous §2.`,
      `  3. Les membres voient leur vérification à jour dès la fin du batch.`,
      ``,
      `Ouvre l'admin : ${adminUrl}`,
      ``,
      `Rappel automatique — envoyé uniquement quand des preuves MT5 sont en attente d'analyse passé le`,
      `délai de courtoisie. Aucune preuve n'est analysée sur un serveur (le batch reste manuel, par`,
      `sécurité du compte).`,
    ].join('\n'),
  });
}
