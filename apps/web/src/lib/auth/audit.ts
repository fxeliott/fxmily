import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import {
  isAnnotationUploadKind,
  isProofUploadKind,
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
  // T1 "cerveau actif" — crisis routing wire on the member's free-text
  // (morning `intention`, evening `journalNote` + `gratitudeItems`). The
  // `*.submitted` rows carry `crisisLevel` in metadata; `*.crisis_detected`
  // duplicates the signal with `matchedLabels` + `source` for forensic
  // alerting (mirror of the V1.8 REFLECT / training_debrief pair). The wiring
  // target was reserved in `lib/safety/crisis-detection.ts:28`.
  | 'checkin.crisis_detected'
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
  // V1.7 — local Claude Code batch (Eliott's Max subscription path, no API spend)
  | 'weekly_report.batch.pulled'
  | 'weekly_report.batch.persisted'
  | 'weekly_report.batch.skipped'
  | 'weekly_report.batch.invalid_output'
  | 'weekly_report.batch.persist_failed'
  // V1.7.1 — crisis routing wire on the batch output (safety)
  | 'weekly_report.batch.crisis_detected'
  // Session 4 — AMF output gate (SPEC §2 posture invariant). Emitted when
  // the weekly AI output contains AMF/CIF-regulated content (directional
  // advice, entry/exit signals, price targets, breakout calls). PII-FREE:
  // carries only `matchedLabels` (canonical pattern ids), never the raw
  // output text (RGPD §16). `skipped` counter (not `errors`) — content-
  // policy reject, not a technical failure. Pairs with `reportWarning`.
  | 'weekly_report.batch.amf_violation'
  // S5 10e challenge (D4-01) — same §2/crisis gate on the LIVE cron path
  // (`service.ts generateWeeklyReportForUser`), which previously persisted AI
  // output with no screen. Distinct slugs from the `.batch.*` family so the
  // audit trail tells the two paths apart. PII-FREE (matchedLabels only).
  | 'weekly_report.amf_violation'
  | 'weekly_report.crisis_detected'
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
  // S8 — backtest SESSION container ("crée une session de backtest", brief §31
  // DoD#1). STATISTICAL ISOLATION: metadata carries ids/flags ONLY
  // (`trainingSessionId`, `hasSymbol`, `hasTimeframe`) — NEVER the member's
  // free text (`label` / `notes`) nor any backtest P&L. A session container
  // never touches the real edge (§21.5 invariant).
  | 'training_session.created'
  | 'training_session.ended'
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
  // Session 4 — AMF output gate (SPEC §2 posture invariant). Mirror of
  // `weekly_report.batch.amf_violation` for the monthly pipeline. PII-FREE:
  // carries `matchedLabels` + `monthStart` + `ranAt` — never the AI text.
  | 'monthly_debrief.batch.amf_violation'
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
  | 'calendar.disclosure.shown'
  // V1.7 §30 J-M2 — meeting attendance member declaration (`/reunions`). ONE
  // slug: the declaration is a 100% closed instrument (meetingId + 2 enums/
  // booleans, ZERO free-text) ⇒ NO crisis/injection surface (mirror V1.5
  // mindset_check / V2.3 pre_trade_check). PII-FREE metadata expected :
  // `{meetingId, attendanceMode, contentReviewed}` — NEVER the Ichor content
  // itself (posture §2: `contentReviewed` is a boolean, never the analysis).
  // The admin slugs (`meeting.generated`, `admin.meeting.cancelled`) follow
  // in J-M3.
  | 'meeting.attendance.declared'
  // V1.7 §30 J-M3 — meeting admin surface (cron generation + slot cancel).
  // `meeting.generated` is the `generate-meetings` cron heartbeat: ONE row per
  // scan carrying `{generated, skipped, ranAt}` (counts + timestamp only —
  // strict `cron.<name>.scan`-style observability, no PII, no member id, no
  // Ichor content). `admin.meeting.cancelled` is emitted by the admin
  // cancel/uncancel Server Action: PII-FREE metadata `{meetingId, cancelled}`
  // (the boolean records the resulting state) — NEVER the `cancelledReason`
  // free-text (posture §2 + audit-PII-free invariant §30.7), mirror of the
  // V2.1 `admin.note.*` admin-scoped pattern.
  | 'meeting.generated'
  | 'admin.meeting.cancelled'
  // V2.5 — Self-service access requests (public "Rejoindre" front door).
  // PII-FREE metadata invariant (BLOCKING): these rows NEVER carry the
  // requester's name or email — only opaque ids. The `AccessRequest` row
  // itself holds the PII (with the RGPD purge cron path), so re-logging it
  // as plaintext audit metadata serves no purpose and breaks data
  // minimisation (mirror `invitation.created` :104-105).
  //   - access_request.created     : public action, NO id (anti-enumeration —
  //                                  same neutral audit whether or not a row
  //                                  was actually created). `metadata: {}`.
  //   - access_request.approved    : admin action, `{requestId}` only.
  //   - access_request.rejected    : admin action, `{requestId}` only.
  //   - admin.access_requests.listed : admin page view, `{count}` only.
  //   - cron.purge_access_requests.scan : weekly RGPD purge heartbeat,
  //                                  counts + threshold + ranAt only.
  | 'access_request.created'
  | 'access_request.approved'
  | 'access_request.rejected'
  | 'admin.access_requests.listed'
  | 'cron.purge_access_requests.scan'
  // Session 5 §26 — calendar overdue safety-net (DoD#4 permanence). Heartbeat
  // on EVERY run; counts + weekStart + emailOutcome only, PII-free.
  | 'cron.calendar_overdue.scan'
  // Session 5 §25 — monthly debrief overdue safety-net (DoD#2 permanence).
  // Heartbeat on EVERY run; counts + monthStart + emailOutcome only, PII-free.
  | 'cron.monthly_debrief_overdue.scan'
  // S2 — onboarding profile overdue safety-net (profilage permanence, 3rd twin
  // of the §26 calendar / §25 monthly nets). Heartbeat on EVERY run; counts +
  // oldestCompletedAt + emailOutcome only, PII-free.
  | 'cron.onboarding_profile_overdue.scan'
  // J8 — weekly report overdue safety-net (digest permanence, 4th twin of the
  // §26 calendar / §25 monthly / S2 onboarding nets). Heartbeat on EVERY run;
  // counts + weekStart + emailOutcome only, PII-free.
  | 'cron.weekly_report_overdue.scan'
  // S3 — Vérification & Honnêteté radicale (SPEC §33). Member-facing surface:
  // broker accounts + MT5 proof uploads + member reasons on discrepancies.
  // PII-FREE metadata invariant: rows carry opaque ids + enum-ish fields only
  // (`{accountId, type}` / `{proofId, accountId, kind, key, mime, size}` /
  // `{discrepancyId}`) — NEVER the account label, broker name free-text, the
  // member's reason text, nor any extracted P&L. `verification.proof.uploaded`
  // is a DISTINCT slug from `trade.screenshot.uploaded` ON PURPOSE: a proof
  // documents the REALITY side (§33.3), never journal activity.
  | 'verification.account.created'
  | 'verification.proof.uploaded'
  | 'verification.proof.deleted'
  | 'verification.discrepancy.reason_submitted'
  | 'admin.verification.viewed'
  // S3 — vision batch pipeline (5th local Claude batch, carbon of the
  // onboarding/weekly/monthly/calendar lifecycle — SPEC §33.4). PII-FREE
  // metadata expected (mirror `onboarding.batch.*`): counts + ranAt + opaque
  // ids + `matchedLabels`/`issuesCount` — NEVER the extracted positions
  // payload, NEVER raw Claude output, NEVER the proof image bytes/labels.
  | 'verification.batch.pulled'
  | 'verification.batch.persisted'
  | 'verification.batch.skipped'
  | 'verification.batch.invalid_output'
  | 'verification.batch.persist_failed'
  | 'verification.batch.crisis_detected'
  | 'verification.batch.amf_violation'
  | 'verification.proof.analyzed'
  // AUTONOMY-1 — verification overdue safety-net (5th twin of the §26 calendar /
  // §25 monthly / S2 onboarding / J8 weekly nets — the VISION batch is the only
  // local Claude pipeline that lacked an anti-oubli nudge). Heartbeat on EVERY
  // run; counts + oldestUploadedAt + emailOutcome only, PII-free (NEVER a
  // proofId, memberId, broker label, nor extracted P&L).
  | 'cron.verification_overdue.scan'
  // S3 — daily verification scan (généralisation preuve-par-la-réalité §33.5:
  // unfilled rituals → discrepancies → ScoreEvents → ConstancyScore upsert →
  // repetition alerts → Douglas dispatch). Heartbeat on EVERY run; counts +
  // ranAt only, PII-free. Strict `cron.<name>.scan` convention (cron-watch).
  | 'cron.verification_scan.scan'
  | 'verification.alert.created'
  // S3 §33 « micro-relance » — one benevolent nudge sent on an isolated
  // below-threshold gap BEFORE any alert escalates. PII-free metadata
  // (`{discrepancyId, discrepancyType}`), counts-grade like the alert slug.
  | 'verification.gentle_reminder.sent'
  | 'verification.score.computed'
  // V2 S2 — Universal tracking engine member capture (`/tracking/[instrument]`).
  // ONE slug: the instrument is 100% CLOSED (boolean/likert/scale/choice, ZERO
  // free-text by design — `lib/tracking/types.ts`) ⇒ NO crisis/injection
  // surface, so NO `*.crisis_detected` counterpart (mirror V1.5 mindset_check /
  // V2.3 pre_trade_check). PII-FREE metadata: `{instrumentKey, instrumentVersion,
  // occurrenceKey, axis, wasNew}` — NEVER the `responses` payload, NEVER a P&L,
  // NEVER anything from the real edge (§21.5/§2 statistical isolation).
  | 'tracking_entry.submitted';

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
  // S3: an MT5 proof upload traces the verification surface, never the
  // journal — a proof must not inflate the `trade.screenshot.uploaded`
  // engagement/forensic signal (mirror of the §21.5 training rationale).
  if (isProofUploadKind(kind)) return 'verification.proof.uploaded';
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
