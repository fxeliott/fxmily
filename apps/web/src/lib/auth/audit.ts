import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import {
  isAnnotationUploadKind,
  isTrainingAnnotationUploadKind,
  isTrainingUploadKind,
  type UploadKind,
} from '@/lib/storage/types';

/**
 * Lightweight audit log helper (SPEC §6.8, §9.2).
 *
 * Writes are best-effort: we never want a logging failure to fail an auth
 * flow. Errors are swallowed and surfaced to the dev console.
 *
 * IPs are SHA-256-hashed before storage. We salt the hash with `AUTH_SECRET`
 * so the same IP across two installs produces different hashes — this avoids
 * cross-instance correlation and makes rainbow-table reversal infeasible.
 */

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.rate_limited'
  | 'auth.logout'
  | 'invitation.created'
  | 'invitation.consumed'
  | 'onboarding.completed'
  | 'trade.created'
  | 'trade.closed'
  | 'trade.deleted'
  | 'trade.screenshot.uploaded'
  | 'admin.members.listed'
  | 'admin.member.viewed'
  | 'admin.trade.viewed'
  // J4 — annotation workflow
  | 'admin.annotation.created'
  | 'admin.annotation.deleted'
  | 'admin.annotation.media.uploaded'
  | 'member.annotations.viewed'
  | 'notification.enqueued'
  // J5 — daily check-ins
  | 'checkin.morning.submitted'
  | 'checkin.evening.submitted'
  | 'cron.checkin_reminders.scan'
  // J6 — behavioral score snapshot
  | 'score.computed'
  | 'cron.recompute_scores.scan'
  // J7 - Mark Douglas card module (created/updated reserved for J7.5 admin CRUD form)
  | 'douglas.card.deleted'
  | 'douglas.card.published'
  | 'douglas.card.unpublished'
  | 'douglas.dispatched'
  | 'douglas.delivery.seen'
  | 'douglas.delivery.bulk_seen'
  | 'douglas.delivery.dismissed'
  | 'douglas.delivery.helpful'
  | 'douglas.favorite.added'
  | 'douglas.favorite.removed'
  | 'cron.dispatch_douglas.scan'
  // J8 — weekly AI report (Phase A foundation: actions reserved, emitted in Phase B+)
  | 'weekly_report.generated'
  | 'weekly_report.email.sent'
  | 'weekly_report.email.failed'
  | 'weekly_report.email.skipped'
  // V1.7 — local Claude Code batch (Eliot's Max subscription path, no API spend)
  | 'weekly_report.batch.pulled'
  | 'weekly_report.batch.persisted'
  | 'weekly_report.batch.skipped'
  | 'weekly_report.batch.invalid_output'
  | 'weekly_report.batch.persist_failed'
  // V1.7.1 — crisis routing wire on the batch output (safety)
  | 'weekly_report.batch.crisis_detected'
  | 'admin.weekly_report.viewed'
  | 'cron.weekly_reports.scan'
  | 'cron.weekly_reports.batch_done'
  // J9 — Web Push notifications (VAPID + Service Worker + dispatcher)
  | 'push.subscription.created'
  | 'push.subscription.updated'
  | 'push.subscription.deleted'
  | 'push.permission.granted'
  | 'push.permission.denied'
  | 'push.preference.toggled'
  | 'notification.dispatched'
  | 'notification.dispatch.failed'
  | 'notification.dispatch.skipped'
  | 'notification.fallback.emailed'
  // V1.6 — SPEC §18.2 email frequency cap. Emitted when a non-transactional
  // notification's fallback email is skipped because the user has already
  // received >= 3 fallback emails in the rolling 24h window.
  | 'notification.fallback.capped'
  // V1.5.1 — §27.6 strict push-only allowlist (e.g. `mindset_check_ready`).
  // Emitted when the dispatcher skips the email fallback because the slug is
  // in `EMAIL_FALLBACK_SKIP_TYPES` (anti-FOMO product invariant, no email
  // copy even under cap-24h logic).
  | 'notification.fallback.skipped_push_only'
  | 'cron.dispatch_notifications.scan'
  // J10 — RGPD account self-service + ops crons
  | 'account.data.exported'
  | 'account.deletion.requested'
  | 'account.deletion.cancelled'
  | 'account.deletion.materialised'
  | 'account.deletion.purged'
  | 'cron.purge_deleted.scan'
  | 'cron.purge_push_subscriptions.scan'
  | 'cron.purge_audit_log.scan'
  // J10 Phase J — observability dashboard surface
  | 'admin.system.viewed'
  | 'cron.health.scan'
  // V2.0 — TRACK module (master plan A2-A5 must-have habit logging).
  // `habit_log.upserted` carries `kind` + `wasNew` in metadata so the
  // analytics pipeline (V2.1 D-features) can distinguish create vs update.
  // Pre-declared even though no Server Action exists yet (V2.0 backend
  // bootstrap is data + Zod + service only) — anti-regression vs canon
  // process where audit slugs ship with the model migration.
  | 'habit_log.upserted'
  | 'habit_log.deleted'
  // V2.1 — Admin private notes per member (SPEC §7.7). The member NEVER
  // sees these. `*.created`/`*.deleted` carry `noteId` + `memberId` in
  // metadata (PII-free — never the body text). Mirrors the J4
  // `admin.annotation.*` admin-scoped pattern.
  | 'admin.note.created'
  | 'admin.note.deleted'
  // V1.8 — REFLECT module (member-facing reflection + CBT Ellis ABCD).
  // `*.submitted` rows carry `crisisLevel` + `injectionSuspected` in metadata
  // so a single row captures the full audit picture for a submission.
  // `*.crisis_detected` rows duplicate the signal with `matchedLabels` for
  // forensic alerting (Sentry escalation pairs with these).
  | 'weekly_review.submitted'
  | 'weekly_review.crisis_detected'
  | 'reflection.submitted'
  | 'reflection.crisis_detected'
  // V1.2 — Mode Entraînement / Backtest (SPEC §21). STATISTICAL ISOLATION:
  // these slugs trace the EFFORT only. `training_trade.created` carries
  // `trainingTradeId` in metadata (PII-free — NEVER the P&L / `resultR`) so
  // the J-T4 engagement + inactivity-trigger wiring can count practice
  // volume/recency without a backtest result ever touching the real edge
  // (§21.5 invariant). `training_trade.screenshot.uploaded` (J-T2) is a
  // DISTINCT slug from the real `trade.screenshot.uploaded` ON PURPOSE: a
  // backtest upload must never inflate the real-edge screenshot-upload
  // signal a forensic/engagement query counts (§21.5). `admin.training_
  // annotation.*` mirror the J4 `admin.annotation.*` admin-scoped pattern.
  // `admin.training_annotation.media.uploaded` + `admin.training_trade.viewed`
  // (J-T3) are DISTINCT from the real-edge `admin.annotation.media.uploaded` /
  // `admin.trade.viewed` ON PURPOSE: an admin correction/view on a backtest
  // must never inflate a real-edge forensic signal (§21.5).
  // Pre-declared even though the Server Actions land in J-T2/J-T3 —
  // anti-regression, same canon as the V2.0 `habit_log.*` pre-declaration.
  | 'training_trade.created'
  | 'training_trade.screenshot.uploaded'
  | 'admin.training_annotation.created'
  | 'admin.training_annotation.deleted'
  | 'admin.training_annotation.media.uploaded'
  | 'admin.training_trade.viewed'
  // V1.3 — Débrief Training dédié (SPEC §23, jalon #1 séquence §21.6).
  // Mirror of the V1.8 REFLECT `*.submitted` / `*.crisis_detected` pair:
  // `training_debrief.submitted` carries `weekStart` + `crisisLevel` +
  // `injectionSuspected` (+ `injectionLabels` when suspected) + `wasNew` so a
  // single row captures the full submission picture; `*.crisis_detected`
  // duplicates the signal with `matchedLabels` for forensic Sentry pairing.
  // PII-FREE and §21.5-clean: NEVER the reflective free-text, NEVER a backtest
  // P&L (`resultR`/`outcome`) — the debrief audit traces a member's reflective
  // EFFORT only, exactly like the rest of the training surface.
  | 'training_debrief.submitted'
  | 'training_debrief.crisis_detected'
  // V1.4 — Débrief Mensuel IA dédié (SPEC §25, jalon #2 séquence §21.6).
  // EXACT mirror of the V1.7 `weekly_report.batch.*` slug family (the
  // monthly pipeline is a carbon of the weekly batch-local Claude Max
  // path). PII-FREE: rows carry counts + `monthStart` + `ranAt` only —
  // never a member email/name, never the AI free-text, never a backtest
  // P&L (§21.5/§25.7). `*.crisis_detected` pairs with Sentry escalation
  // and carries `level` + `matchedLabels` for forensic alerting (crisis
  // on the AI OUTPUT ⇒ skip persist, mirror V1.7.1 — not the REFLECT
  // persist-anyway path which only applies to member-written text).
  | 'monthly_debrief.batch.pulled'
  | 'monthly_debrief.batch.persisted'
  | 'monthly_debrief.batch.skipped'
  | 'monthly_debrief.batch.invalid_output'
  | 'monthly_debrief.batch.persist_failed'
  | 'monthly_debrief.batch.crisis_detected'
  // V1.5 — QCM athlète / auto-évaluation mindset (SPEC §27, jalon #3 séquence
  // §21.6). ONE slug only: the instrument is 100 % closed (Likert) — ZERO
  // free-text ⇒ NO crisis/injection surface (§27.6/§27.7), so there is NO
  // `*.crisis_detected` counterpart (unlike training_debrief/REFLECT).
  // PII-FREE and §21.5/§27.7-clean: the row carries `checkId` + `weekStart` +
  // `instrumentVersion` + `wasNew` only — NEVER the responses payload, NEVER
  // a P&L, NEVER anything from the real edge. `cron.mindset_check_reminders.
  // scan` is the weekly heartbeat (counts + `weekStart` + `ranAt`), strict
  // `cron.<name>.scan` underscore convention (cron-watch — V1.6 Bug #4).
  | 'mindset_check.submitted'
  | 'cron.mindset_check_reminders.scan'
  // V2.3 — Pre-trade circuit breaker (ADR-003, jalon Session BB+CC). Mark
  // Douglas 4 primary trading fears (Trading in the Zone ch.7-8) + Gollwitzer
  // if-then implementation intentions meta d=0.65 (PMC4500900). ONE slug:
  // the instrument is 100% closed (4 enum answers, ZERO free-text) ⇒ NO
  // crisis/injection surface (no `*.crisis_detected` counterpart, mirrors
  // V1.5 mindset_check). PII-FREE metadata: `{checkId, reasonToTrade,
  // emotionLabel, planAlignment, stopLossPredefined, linkedTradeId: null}`.
  // `linkedTradeId` starts as null at creation ; the auto-link wired in
  // `createTrade*` / `closeTrade*` enriches the `trade.created` /
  // `trade.closed` metadata with `linkedPreTradeCheckId` (NOT a separate
  // slug on the check — the check row's `linkedTradeId` column is the
  // authoritative join).
  | 'pre_trade_check.created'
  // V2.4 — Onboarding interview profilage IA (Session α, M3 directive 2026-05-27).
  // Lifecycle slugs : started (row created) → answer_submitted (each answer
  // append, idempotent on upsert) → completed (member finalize) OR abandoned
  // (cron sweep V2.4+ after 7d inactivity). PII-FREE metadata expected :
  // `{interviewId, instrumentVersion}` for start ; +`{questionIndex, questionKey}`
  // for answer ; +`{totalAnswers, completedAt}` for completed. NEVER log
  // `answerText` content nor Claude raw output (Phase A.2 future analysis
  // slugs `member_profile.analyzed`/`.published` will follow same PII-free rule).
  | 'onboarding.interview.started'
  | 'onboarding.interview.answer_submitted'
  | 'onboarding.interview.completed'
  | 'onboarding.interview.abandoned'
  // V2.4 Phase B — safety routing wired in `appendAnswerAction`. The
  // Server Action persists the answer ANYWAY (Q4=A persist-anyway carbone
  // V1.8 REFLECT — silent skip would break the wizard UX) and audits the
  // safety signal in a SEPARATE row paired with Sentry escalation
  // (HIGH → reportError page-out, MEDIUM → reportWarning). PII-FREE
  // metadata expected :
  //   - crisis_detected     : `{interviewId, questionIndex, level, matchedLabels}`
  //   - injection_suspected : `{interviewId, questionIndex, matchedLabels}`
  // NEVER log `answerText` content. Crisis level `low` is NOT escalated to
  // the audit log (mirror V1.7.1 — low = emotional-fatigue noise that
  // would drown the medium/high signal). Injection always audits when
  // matched (it's a security boundary, not a content policy).
  | 'onboarding.interview.crisis_detected'
  | 'onboarding.interview.injection_suspected'
  // V2.4 Phase A.2 — Onboarding interview batch local Claude pipeline
  // (Session β, M3 directive 2026-05-28). Mirror V1.7 weekly-report batch
  // canonical lifecycle. PII-FREE metadata expected :
  //   - analyzed   : `{userId, interviewId, claudeModelVersion, instrumentVersion, mocked}`
  //   - published  : `{userId, interviewId, profileId}` (admin gate flow, future)
  //   - pulled     : `{ranAt, entriesCount, instrumentVersion}`
  //   - persisted  : `{ranAt, persisted, skipped, errors, total}`
  //   - skipped    : `{userId, interviewId, reason}`
  //   - invalid_output : `{userId, interviewId, issuesCount}`
  //   - persist_failed : `{userId, interviewId, error (truncated 200)}`
  //   - crisis_detected : `{userId, level, matchedLabels}` (mirror V1.7.1)
  //   - amf_violation   : `{userId, matchedLabels}` (post-gen regex filter)
  //   - evidence_invalid: `{userId, invalidIndexes}` (substring NFC failure)
  // NEVER log `answerText`, Claude raw output (summary/highlights/axes),
  // pseudonymLabel.
  | 'member_profile.analyzed'
  | 'member_profile.published'
  | 'onboarding.batch.pulled'
  | 'onboarding.batch.persisted'
  | 'onboarding.batch.skipped'
  | 'onboarding.batch.invalid_output'
  | 'onboarding.batch.persist_failed'
  | 'onboarding.batch.crisis_detected'
  | 'onboarding.batch.amf_violation'
  | 'onboarding.batch.evidence_invalid'
  // §26 — Calendrier adaptatif (J-C1 pre-declared, wired J-C2/J-C3/J-C4).
  // Mirror the V1.7 weekly-report batch canonical lifecycle. PII-FREE metadata
  // expected (posture §2 — NEVER log responses, schedule, pseudonymLabel) :
  //   - questionnaire.submitted : `{userId, weekStart, instrumentVersion, wasNew}` (J-C3 action)
  //   - batch.pulled      : `{ranAt, entriesCount, weekStart}` (J-C2 /pull)
  //   - batch.persisted   : `{ranAt, persisted, skipped, errors, total}` (J-C2 /persist)
  //   - batch.skipped     : `{userId, weekStart, reason}` (no questionnaire / already generated)
  //   - batch.invalid_output : `{userId, weekStart, issuesCount}` (Zod .strict() fail)
  //   - batch.persist_failed : `{userId, weekStart, error (truncated 200)}`
  //   - batch.crisis_detected : `{userId, weekStart, level, matchedLabels}` (mirror V1.7.1, AI output)
  //   - batch.amf_violation : `{userId, weekStart, matchedLabels}` (J-C2 §2 posture gate, mirror onboarding.batch.amf_violation)
  //   - disclosure.shown  : `{userId, weekStart}` (EU AI Act 50(1) banner first view, J-C4)
  | 'calendar.questionnaire.submitted'
  | 'calendar.batch.pulled'
  | 'calendar.batch.persisted'
  | 'calendar.batch.skipped'
  | 'calendar.batch.invalid_output'
  | 'calendar.batch.persist_failed'
  | 'calendar.batch.crisis_detected'
  | 'calendar.batch.amf_violation'
  | 'calendar.disclosure.shown';

// T5 audit slugs (`admin.public_trade.*`) were REMOVED 2026-05-25 when the
// public Track Record was split out to a standalone repo
// (`trackrecord-fxmily`). The admin CRUD now lives in a Hono Worker
// (`apps/admin-worker`) backed by Neon Postgres — see
// <https://github.com/fxeliott/trackrecord-fxmily>. This monorepo no longer
// touches `public_trades` / `public_trade_partials`.

/**
 * Resolve the audit slug for an `/api/uploads` screenshot upload by kind.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5, BLOCKING): a Mode-Entraînement
 * backtest upload MUST emit `training_trade.screenshot.uploaded`, NEVER the
 * real-edge `trade.screenshot.uploaded` (that would inflate a real-edge
 * forensic/engagement signal with backtest activity). This is extracted from
 * the route's inline ternary precisely so the §21.5 mapping has a unit-tested
 * guard — the upload route has no test of its own, and a silent collapse of
 * the ternary is the single most regression-exposed point of the invariant
 * (security-auditor J-T2 T2-2).
 */
export function resolveUploadAuditAction(kind: UploadKind): AuditAction {
  if (isAnnotationUploadKind(kind)) return 'admin.annotation.media.uploaded';
  // J-T3: distinct admin slug for a backtest correction upload — grouped
  // with the annotation branch (both admin-annotation media) and kept ahead
  // of the member training branch. The guards are disjoint, so ordering is
  // for clarity; the §21.5 isolation is the slug value, not the order.
  if (isTrainingAnnotationUploadKind(kind)) return 'admin.training_annotation.media.uploaded';
  if (isTrainingUploadKind(kind)) return 'training_trade.screenshot.uploaded';
  return 'trade.screenshot.uploaded';
}

export interface LogAuditParams {
  action: AuditAction;
  userId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env.AUTH_SECRET}:${ip}`, 'utf8').digest('hex');
}

export async function logAudit({
  action,
  userId = null,
  ip = null,
  userAgent = null,
  metadata,
}: LogAuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        userId: userId ?? null,
        ipHash: ip ? hashIp(ip) : null,
        userAgent: userAgent?.slice(0, 512) ?? null, // bound the column
        ...(metadata ? { metadata: metadata as object } : {}),
      },
    });
  } catch (err) {
    // Never let audit log failures break the auth flow.
    console.error('[audit] failed to log', action, err);
  }
}
