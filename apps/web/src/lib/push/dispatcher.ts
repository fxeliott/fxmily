import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { sendNotificationFallbackEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportError, reportWarning } from '@/lib/observability';
import { getEffectivePreferences } from '@/lib/push/preferences';
import {
  bumpSubscriptionLastSeen,
  deletePushSubscriptionByEndpoint,
  listDispatchableSubscriptionsForUser,
} from '@/lib/push/service';
import { getWebPushClient, type SendOptions, type SendResult } from '@/lib/push/web-push-client';
import { type NotificationTypeSlug } from '@/lib/schemas/push-subscription';

/**
 * Web Push dispatcher (J9 phase C).
 *
 * Carbon-copied pattern from J8 weekly-report:
 *   - Pure functions for `buildPayload`, `classifyError`, `nextAttemptDelay`.
 *   - Single side-effecting `dispatchOne(rowId)` that owns the whole row
 *     lifecycle (claim → send → mark sent OR re-queue OR fail).
 *   - Batch entry `dispatchAllReady()` walks the queue with a SQL-level
 *     atomic claim (race-safe between concurrent cron runs).
 *
 * Atomic claim pattern :
 *   `UPDATE notification_queue SET status='dispatching', attempts=attempts+1
 *    WHERE id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`
 *   `claim.count === 1` → we own the row. `0` → another instance got it; skip.
 *
 * Retry budget : 3 attempts max. After that, status='failed' and (TODO J9.5+)
 * the email fallback path can pick it up via the `notification.fallback.emailed`
 * audit hook (SPEC §18.2 mitigation for iOS push fragility).
 *
 * Posture (anti-FOMO Mark Douglas):
 *   - urgency MAX = `normal` (never `high` — that's reserved for incoming-call/2FA).
 *   - title/body strings are factual ("1 correction reçue") not anxious.
 *   - No persistent badge spam — `app_badge` resets on click via SW.
 *
 * NEVER LOG payload content (RGPD §16). Only metadata.
 */

// ── Pure functions ─────────────────────────────────────────────────────────

const APP_BASE_URL_DEFAULT = 'http://localhost:3000';

/**
 * Per-category TTL (seconds). Past TTL the push service drops the message
 * silently rather than queuing it forever — important for time-sensitive
 * reminders.
 */
export const TTL_BY_TYPE: Record<NotificationTypeSlug, number> = {
  annotation_received: 86400, // 24h — corrections stay relevant a day
  training_annotation_received: 86400, // 24h — backtest corrections, same window
  checkin_morning_reminder: 3600, // 1h — past 9am the matin slot is mostly gone
  checkin_evening_reminder: 3600, // 1h — past 22h the soir slot is gone
  douglas_card_delivered: 21600, // 6h — tilt cards lose freshness fast
  weekly_report_ready: 21600, // 6h — admin Sunday digest, can wait until morning
};

/// RFC 8030 urgency. `low` = battery-friendly (reminders that aren't critical).
export const URGENCY_BY_TYPE: Record<NotificationTypeSlug, 'low' | 'normal'> = {
  annotation_received: 'normal',
  training_annotation_received: 'normal',
  checkin_morning_reminder: 'low',
  checkin_evening_reminder: 'low',
  douglas_card_delivered: 'normal',
  weekly_report_ready: 'low',
};

export type BuiltPayload = {
  /** Apple declarative envelope (RFC 8030 magic key 8030). */
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    navigate: string;
    lang: 'fr-FR';
    dir: 'ltr';
    silent: false;
    tag: string;
  };
  /** Extras read by the SW for the legacy/imperative path. */
  type: NotificationTypeSlug;
  id: string;
};

/**
 * Build the Apple declarative + classic dual payload from a queue row's
 * `type` + `payload` columns. Pure — no DB, no I/O.
 *
 * Title/body copy is hardcoded here (not in the DB row) so we can ship safe
 * Mark Douglas-aligned strings with code review oversight. The DB payload
 * carries only IDs / counts that the strings reference.
 *
 * @param appBaseUrl base URL for `navigate` (defaults to `http://localhost:3000`).
 */
export function buildPayload(
  type: NotificationTypeSlug,
  notificationId: string,
  payloadJson: unknown,
  appBaseUrl = APP_BASE_URL_DEFAULT,
): BuiltPayload {
  const payload = (payloadJson ?? {}) as Record<string, unknown>;

  let title: string;
  let body: string;
  let path: string;

  switch (type) {
    case 'annotation_received': {
      const tradeId = typeof payload.tradeId === 'string' ? payload.tradeId : '';
      title = 'Nouvelle correction reçue';
      body = "Eliot a laissé une correction sur l'un de tes trades.";
      path = tradeId ? `/journal/${tradeId}` : '/journal';
      break;
    }
    case 'training_annotation_received': {
      // §21.5: distinct copy + deep-link to the TRAINING surface, never
      // `/journal` — a backtest correction stays on the entraînement side.
      const trainingTradeId =
        typeof payload.trainingTradeId === 'string' ? payload.trainingTradeId : '';
      title = 'Correction reçue (entraînement)';
      body = "Eliot a laissé une correction sur l'un de tes backtests.";
      path = trainingTradeId ? `/training/${trainingTradeId}` : '/training';
      break;
    }
    case 'checkin_morning_reminder': {
      title = 'Check-in matin';
      body = 'Trois minutes pour poser ton intention du jour.';
      path = '/checkin/morning';
      break;
    }
    case 'checkin_evening_reminder': {
      title = 'Check-in soir';
      body = 'Bilan rapide du jour : plan, ressenti, gratitude.';
      path = '/checkin/evening';
      break;
    }
    case 'douglas_card_delivered': {
      const slug = typeof payload.cardSlug === 'string' ? payload.cardSlug : '';
      title = 'Nouvelle fiche Mark Douglas';
      body = 'Une fiche est arrivée dans ta bibliothèque, choisie selon ton activité récente.';
      path = slug ? `/library/${slug}` : '/library/inbox';
      break;
    }
    case 'weekly_report_ready': {
      const reportId = typeof payload.reportId === 'string' ? payload.reportId : '';
      title = 'Rapport hebdo prêt';
      body = 'Ton digest hebdomadaire des membres est prêt.';
      path = reportId ? `/admin/reports/${reportId}` : '/admin/reports';
      break;
    }
  }

  return {
    web_push: 8030,
    notification: {
      title,
      body,
      navigate: `${appBaseUrl}${path}`,
      lang: 'fr-FR',
      dir: 'ltr',
      silent: false,
      tag: type, // coalescing per category — replaces older notif of same tag
    },
    type,
    id: notificationId,
  };
}

/**
 * Classify a `SendResult` outcome into one of three buckets:
 *   - `delete_subscription` — endpoint is dead (404/410) or request was malformed
 *     (413 payload too large means our code is buggy, not the subscriber's
 *     fault, but deleting would lose that device permanently — we choose to
 *     mark `failed` instead so a human can debug).
 *   - `retry`               — transient (5xx, 429, timeout, network).
 *   - `fail_permanent`      — out of retry budget OR unclassified error.
 */
export type ResultClassification =
  | { action: 'delete_subscription' }
  | { action: 'retry'; delayMs: number }
  | { action: 'fail_permanent'; reason: string };

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 60_000; // 1 min

/**
 * V1.6 — SPEC §18.2 email frequency cap. A non-transactional notification's
 * fallback email is dropped if the user has already received this many
 * fallback emails in the rolling 24h window (sliding, NOT calendar day).
 * Transactional notifications (auth, invitation, password reset, RGPD) are
 * NEVER capped.
 *
 * 3 / 24h = at most one email per ~8h. Empirically the upper bound where a
 * member still perceives the cadence as informative rather than spammy. If
 * a member's push subscription is chronically broken (e.g. iOS quirks) the
 * audit log surfaces `notification.fallback.capped` so admin can reach out
 * proactively instead of letting Resend free-tier 100/day rate-limit them.
 *
 * Concurrency note (V1.6 audit code-reviewer H2) : this is a SOFT cap, not
 * a hard cap. The audit_log count is read BEFORE the send, so up to
 * CONCURRENCY (= 8 in `dispatchAllReady`) concurrent dispatchOne calls on
 * the same user's permanently-failed notifications can ALL pass the cap
 * check at the same time and send. Worst-case = CONCURRENCY × 1 burst, then
 * subsequent runs are hard-capped. Acceptable at V1 30-member cohort. V2 :
 * wrap with `pg_advisory_xact_lock(hash(userId + 'fallback'))` if hard cap
 * becomes required.
 */
export const EMAIL_FALLBACK_CAP_PER_24H = 3;
export const EMAIL_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Pure helper : decide whether to send the email fallback for a given
 * permanently-failed notification. Side-effect free so it can be unit-tested
 * without DB mocks.
 */
export function shouldSendFallbackEmail(
  isTransactional: boolean,
  recentFallbacks24h: number,
): boolean {
  if (isTransactional) return true;
  return recentFallbacks24h < EMAIL_FALLBACK_CAP_PER_24H;
}

/**
 * Compute the next-attempt delay (ms). Pure helper, exposed for tests.
 *
 *   attempt 1 (= just failed once)  → 1 min
 *   attempt 2 → 4 min
 *   attempt 3 → 16 min
 *
 * Caller adds this to NOW to compute `nextAttemptAt`.
 */
export function nextAttemptDelay(attempt: number, retryAfterSec?: number): number {
  if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
    // Honor server-supplied Retry-After (capped at 30 min to avoid hostage scenarios).
    return Math.min(retryAfterSec, 1800) * 1000;
  }
  // Exponential 4^(attempt-1): 1×, 4×, 16×. Capped at 30 min.
  const factor = Math.min(Math.pow(4, Math.max(0, attempt - 1)), 30);
  return BASE_BACKOFF_MS * factor;
}

export function classifyError(result: SendResult, attemptsAfter: number): ResultClassification {
  if (result.delivered) {
    // Should not be called on success — dispatcher branches before. Keep this
    // check so the function is total.
    return { action: 'fail_permanent', reason: 'unexpected_success_in_classify' };
  }

  if (result.kind === 'gone') {
    return { action: 'delete_subscription' };
  }

  if (result.kind === 'payload_too_large') {
    // Our bug, not theirs. Don't delete the subscription, but stop retrying.
    return { action: 'fail_permanent', reason: 'payload_too_large_413' };
  }

  if (attemptsAfter >= MAX_ATTEMPTS) {
    return { action: 'fail_permanent', reason: `max_attempts_${result.kind}` };
  }

  if (
    result.kind === 'rate_limited' ||
    result.kind === 'server_error' ||
    result.kind === 'timeout' ||
    result.kind === 'network' ||
    result.kind === 'promise_rejected'
  ) {
    return {
      action: 'retry',
      delayMs: nextAttemptDelay(attemptsAfter, result.retryAfterSec ?? undefined),
    };
  }

  return { action: 'fail_permanent', reason: `unclassified_${result.kind}` };
}

// ── Side-effecting dispatch ────────────────────────────────────────────────

export type DispatchOneResult =
  | { status: 'sent'; subscriptionsTried: number; subscriptionsDelivered: number }
  | { status: 'retry'; reason: string; nextAttemptAt: Date }
  | { status: 'failed'; reason: string }
  | { status: 'skipped'; reason: 'already_claimed' | 'preference_off' | 'no_subscriptions' };

/**
 * Atomically claim a single queued notification and dispatch it.
 *
 * Concurrency contract:
 *   - The first cron run to claim the row gets `claim.count === 1` and
 *     proceeds. Concurrent runs get `count === 0` and bail with `skipped`.
 *   - On success: status='sent', dispatchedAt=NOW.
 *   - On retryable failure: status BACK to 'pending' with nextAttemptAt set.
 *   - On permanent failure: status='failed' + audit `notification.dispatch.failed`.
 *
 * Preferences are checked AFTER claim (we don't want a slow preference fetch
 * to widen the race window). If the user opted out of this category, we mark
 * the row as `failed` with reason 'preference_off' and skip the actual send.
 */
export async function dispatchOne(notificationId: string): Promise<DispatchOneResult> {
  const baseUrl = env.AUTH_URL;

  // 1. Atomic claim: pending → dispatching, increment attempts.
  const claim = await db.notificationQueue.updateMany({
    where: {
      id: notificationId,
      status: 'pending',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    data: { status: 'dispatching', attempts: { increment: 1 } },
  });
  if (claim.count === 0) {
    return { status: 'skipped', reason: 'already_claimed' };
  }

  // 2. Re-fetch the row to get the now-bumped attempts + payload + user.
  //    V1.6 — select isTransactional too for the email fallback frequency cap.
  const row = await db.notificationQueue.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      userId: true,
      type: true,
      payload: true,
      attempts: true,
      isTransactional: true,
    },
  });
  if (row === null) {
    // Should not happen — claim succeeded → row exists.
    return { status: 'failed', reason: 'row_disappeared_after_claim' };
  }
  const slug = row.type as NotificationTypeSlug;

  // 3. Check preferences. If opted out, mark failed-with-skip and audit.
  const prefs = await getEffectivePreferences(row.userId);
  if (prefs[slug] === false) {
    await db.notificationQueue.update({
      where: { id: row.id },
      data: { status: 'failed', failureReason: 'preference_off', lastErrorCode: 'preference_off' },
    });
    await logAudit({
      action: 'notification.dispatch.skipped',
      userId: row.userId,
      metadata: { notificationId: row.id, type: slug, reason: 'preference_off' },
    });
    return { status: 'skipped', reason: 'preference_off' };
  }

  // 4. Resolve subscriptions for this user. If none, drop the row.
  const subscriptions = await listDispatchableSubscriptionsForUser(row.userId);
  if (subscriptions.length === 0) {
    await db.notificationQueue.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        failureReason: 'no_subscriptions',
        lastErrorCode: 'no_subscriptions',
      },
    });
    await logAudit({
      action: 'notification.dispatch.skipped',
      userId: row.userId,
      metadata: { notificationId: row.id, type: slug, reason: 'no_subscriptions' },
    });
    return { status: 'skipped', reason: 'no_subscriptions' };
  }

  // 5. Fan out to every subscription. Track per-device success.
  const client = getWebPushClient();
  const payload = buildPayload(slug, row.id, row.payload, baseUrl);
  const sendOptions: SendOptions = {
    ttl: TTL_BY_TYPE[slug],
    urgency: URGENCY_BY_TYPE[slug],
    topic: `${slug}-${row.id.slice(-12)}`.slice(0, 32), // ≤32 chars, RFC 8030 §5.4
    timeout: 5000,
  };

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      client.send(
        { endpoint: sub.endpoint, p256dhKey: sub.p256dhKey, authKey: sub.authKey },
        payload,
        sendOptions,
      ),
    ),
  );

  let delivered = 0;
  let goneCount = 0;
  let retryableErrors = 0;
  let lastRetryAfter: number | undefined;
  let lastKind: string | undefined;

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const sub = subscriptions[i];
    if (r === undefined || sub === undefined) continue;
    if (r.status === 'rejected') {
      retryableErrors += 1;
      lastKind = 'promise_rejected';
      continue;
    }
    const send = r.value;
    if (send.delivered) {
      delivered += 1;
      void bumpSubscriptionLastSeen(sub.id);
      continue;
    }
    // Failed. Classify per-device.
    if (send.kind === 'gone') {
      goneCount += 1;
      void deletePushSubscriptionByEndpoint(row.userId, sub.endpoint);
      continue;
    }
    retryableErrors += 1;
    lastKind = send.kind;
    if (send.retryAfterSec !== undefined) lastRetryAfter = send.retryAfterSec;
  }

  // 6. Decide row status from aggregate.
  if (delivered > 0) {
    await db.notificationQueue.update({
      where: { id: row.id },
      data: { status: 'sent', dispatchedAt: new Date() },
    });
    await logAudit({
      action: 'notification.dispatched',
      userId: row.userId,
      metadata: {
        notificationId: row.id,
        type: slug,
        attempts: row.attempts,
        subscriptionsTried: subscriptions.length,
        subscriptionsDelivered: delivered,
        goneCount,
      },
    });
    return {
      status: 'sent',
      subscriptionsTried: subscriptions.length,
      subscriptionsDelivered: delivered,
    };
  }

  // No delivery — classify with the worst per-device result we saw.
  const aggregateResult: SendResult =
    retryableErrors > 0
      ? {
          delivered: false,
          statusCode: null,
          kind: (lastKind ?? 'unknown') as Exclude<SendResult, { delivered: true }>['kind'],
          message: `aggregate_failure: ${retryableErrors} retryable, ${goneCount} gone`,
          ...(lastRetryAfter !== undefined ? { retryAfterSec: lastRetryAfter } : {}),
        }
      : {
          delivered: false,
          statusCode: null,
          kind: 'gone',
          message: `all_endpoints_gone: ${goneCount}`,
        };

  const decision = classifyError(aggregateResult, row.attempts);

  if (decision.action === 'retry') {
    const nextAt = new Date(Date.now() + decision.delayMs);
    await db.notificationQueue.update({
      where: { id: row.id },
      data: {
        status: 'pending',
        nextAttemptAt: nextAt,
        lastErrorCode: aggregateResult.delivered === false ? aggregateResult.kind : null,
        failureReason: aggregateResult.delivered === false ? aggregateResult.message : null,
      },
    });
    await logAudit({
      action: 'notification.dispatch.failed',
      userId: row.userId,
      metadata: {
        notificationId: row.id,
        type: slug,
        attempts: row.attempts,
        kind: aggregateResult.delivered === false ? aggregateResult.kind : 'unknown',
        retry: true,
        nextAttemptAt: nextAt.toISOString(),
      },
    });
    return {
      status: 'retry',
      reason: aggregateResult.delivered === false ? aggregateResult.kind : 'unknown',
      nextAttemptAt: nextAt,
    };
  }

  // Permanent failure. Three reason taxonomies map to `decision`:
  //  - `delete_subscription` : every endpoint returned 410 Gone — we already
  //    deleted the rows above. The queue row is `failed` with explicit reason
  //    so admin observability is clear (vs the misleading "unknown").
  //  - `fail_permanent { reason: 'payload_too_large_413' | 'max_attempts_*' | 'unclassified_*' }`
  //  - else                : truly unknown (defensive; should not reach here).
  const failureReason =
    decision.action === 'delete_subscription'
      ? 'all_endpoints_gone'
      : decision.action === 'fail_permanent'
        ? decision.reason
        : 'unknown';
  await db.notificationQueue.update({
    where: { id: row.id },
    data: {
      status: 'failed',
      lastErrorCode: aggregateResult.delivered === false ? aggregateResult.kind : null,
      failureReason,
    },
  });
  await logAudit({
    action: 'notification.dispatch.failed',
    userId: row.userId,
    metadata: {
      notificationId: row.id,
      type: slug,
      attempts: row.attempts,
      kind: aggregateResult.delivered === false ? aggregateResult.kind : 'unknown',
      retry: false,
      reason: failureReason,
    },
  });

  // V1.11 — payload_too_large_413 is a code bug (we sent a payload bigger than
  // the push service accepts), not a transient infra error. Escalate to Sentry
  // as an error (on-call page-out) rather than the silent `notification.dispatch.failed`
  // audit row alone — a systemic payload bug would otherwise stay invisible until
  // a member complains. Round 4 audit O finding.
  if (decision.action === 'fail_permanent' && decision.reason === 'payload_too_large_413') {
    reportError(
      'push.dispatcher',
      new Error('Push payload exceeded 4 KiB limit (413 from push service)'),
      { notificationId: row.id, type: slug, attempts: row.attempts },
    );
  }

  // Email fallback best-effort (SPEC §18.2 mitigation iOS push fragility).
  // Triggered ONLY on permanent failure of an actual dispatch attempt.
  // Skipped for `preference_off` (explicit opt-out, see early return above)
  // and `no_subscriptions` (no device known — V1 keeps email-as-only-channel
  // out of scope; revisit J9.5+ if observed in audit log).
  // Best-effort posture: a Resend hiccup MUST NOT re-fail the dispatcher
  // (the queue row is already marked `failed`, this is just nudge-recovery).
  //
  // V1.6 — SPEC §18.2 frequency cap : a non-transactional notification's
  // fallback email is skipped if the user has already received >= 3 fallback
  // emails in the rolling 24h window. Transactional notifications (auth,
  // invitation, password reset, RGPD) are NEVER capped — they always reach
  // the user. Counted via audit_logs (action='notification.fallback.emailed')
  // which already has the (action, createdAt) index for fast lookup.
  try {
    let allowFallbackEmail = true;
    if (!row.isTransactional) {
      const recentFallbacks = await db.auditLog.count({
        where: {
          action: 'notification.fallback.emailed',
          userId: row.userId,
          createdAt: { gt: new Date(Date.now() - EMAIL_FALLBACK_WINDOW_MS) },
        },
      });
      allowFallbackEmail = shouldSendFallbackEmail(row.isTransactional, recentFallbacks);
      if (!allowFallbackEmail) {
        await logAudit({
          action: 'notification.fallback.capped',
          userId: row.userId,
          metadata: {
            notificationId: row.id,
            type: slug,
            recentFallbacks24h: recentFallbacks,
          },
        });
        // V1.6 polish — operator-visible signal : a member is chronically
        // dropping push events AND has already received the 24h email quota.
        // Admin should reach out proactively (SPEC §18.2 iOS push fragility).
        reportWarning('push.dispatcher', 'email_fallback_capped', {
          notificationId: row.id,
          type: slug,
          userId: row.userId,
          recentFallbacks24h: recentFallbacks,
        });
      }
    }

    if (allowFallbackEmail) {
      const user = await db.user.findUnique({
        where: { id: row.userId },
        select: { email: true, firstName: true },
      });
      if (user !== null) {
        const result = await sendNotificationFallbackEmail({
          to: user.email,
          recipientFirstName: user.firstName,
          type: slug,
          deepUrl: payload.notification.navigate,
        });
        await logAudit({
          action: 'notification.fallback.emailed',
          userId: row.userId,
          metadata: {
            notificationId: row.id,
            type: slug,
            delivered: result.delivered,
            // NEVER log the email address itself — PII, audit metadata stays
            // PII-free (SPEC §16). The notificationId + userId are enough for
            // operator-side correlation.
          },
        });
      }
    }
  } catch (err) {
    // Email fallback failure must not propagate. The queue row is already
    // marked `failed`, this catch is just nudge-recovery — Resend transient
    // 5xx / 429 / DB hiccup all qualify as warning (not error) per V1.6 polish
    // Sentry taxonomy (observability.ts JSDoc).
    reportWarning('push.dispatcher', 'fallback_email_failed', {
      notificationId: row.id,
      type: slug,
      userId: row.userId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }

  return { status: 'failed', reason: failureReason };
}

// ── Batch entry — `dispatchAllReady()` walks the queue ─────────────────────

export type DispatchBatchResult = {
  scanned: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  ranAt: string;
};

/**
 * How long a row may stay in `dispatching` before we consider the dispatcher
 * crashed/timed-out and reclaim it. 10 minutes is generous vs. our 5s per-send
 * timeout and the worst-case Caddy 60s reverse-proxy limit.
 */
const STUCK_DISPATCHING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Walk the queue and dispatch every row that's "ready" (status='pending' AND
 * (nextAttemptAt is null OR nextAttemptAt <= now)). Bounded by `maxPerRun`
 * (default 200) — reverse-proxies (Caddy) typically time out at 60s, so we
 * cap to keep each cron pulse under that budget.
 *
 * Crash recovery: before scanning, any row stuck in `dispatching` for more
 * than 10 minutes is rolled back to `pending` (with `nextAttemptAt = now` so
 * it gets picked up immediately). This handles process crashes / OOM kills
 * between the atomic claim and the status update — without recovery, those
 * rows would never be re-attempted.
 *
 * Returns aggregate counts. Audit row `cron.dispatch_notifications.scan` is
 * emitted by the route handler with this result. The `recoveredStuck` count
 * surfaces in the audit metadata for SLO tracking (≥1/run = signal of
 * dispatcher instability).
 */
export async function dispatchAllReady(
  options: { maxPerRun?: number; now?: Date } = {},
): Promise<DispatchBatchResult & { recoveredStuck: number }> {
  const maxPerRun = options.maxPerRun ?? 200;
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();

  // Crash recovery: reclaim rows stuck in `dispatching` past the threshold.
  const stuckBefore = new Date(now.getTime() - STUCK_DISPATCHING_THRESHOLD_MS);
  const recovered = await db.notificationQueue.updateMany({
    where: {
      status: 'dispatching',
      updatedAt: { lt: stuckBefore },
    },
    data: { status: 'pending', nextAttemptAt: now },
  });
  if (recovered.count > 0) {
    await logAudit({
      action: 'notification.dispatch.failed',
      metadata: {
        recoveredStuck: recovered.count,
        reason: 'stuck_in_dispatching',
        ranAt,
      },
    });
    // V1.6 polish — SLO signal. >=1 recoveredStuck/run = dispatcher instability
    // (process crashed mid-claim, OOM, Caddy 60s timeout). Per JSDoc on
    // STUCK_DISPATCHING_THRESHOLD_MS this should surface, not stay silent.
    reportWarning('push.dispatcher', 'stuck_dispatching_recovered', {
      recoveredStuck: recovered.count,
      thresholdMs: STUCK_DISPATCHING_THRESHOLD_MS,
      ranAt,
    });
  }

  // Read the IDs of rows ready to claim. We claim them one by one inside
  // `dispatchOne` — this preview gives us the work list.
  const ready = await db.notificationQueue.findMany({
    where: {
      status: 'pending',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { createdAt: Prisma.SortOrder.asc }, // FIFO — fairness across users
    take: maxPerRun,
  });

  let sent = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;

  // Bounded concurrency : process the queue in chunks of CONCURRENCY rows
  // with `Promise.allSettled`. Atomic claim already lives inside
  // `dispatchOne` (UPDATE...WHERE status=pending), so two concurrent
  // chunks racing on the same row is safe — the loser gets `skipped`.
  // FIFO order across chunks is preserved (slice walks the sorted list),
  // intra-chunk order is unspecified but irrelevant : each row is
  // independent. Tuned to 8 against Hetzner CX22 + 5s per-send timeout :
  // worst-case ~5s per chunk, 25 chunks = 125s for the 200-row cap, well
  // under the 600s curl timeout in `fxmily-cron`. Per-row Web Push
  // `Promise.allSettled` over subscriptions is unchanged (already there).
  const CONCURRENCY = 8;
  for (let i = 0; i < ready.length; i += CONCURRENCY) {
    const chunk = ready.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((r) => dispatchOne(r.id)));
    for (const settled of results) {
      if (settled.status === 'rejected') {
        // `dispatchOne` is meant to be total — a throw here is a bug, but we
        // refuse to abort the whole batch over one row. Count as failed so
        // the audit metadata stays accurate, the next cron run picks the row
        // back up via the stuck-recovery path or the row-level claim retry.
        failed += 1;
        continue;
      }
      const result = settled.value;
      if (result.status === 'sent') sent += 1;
      else if (result.status === 'retry') retried += 1;
      else if (result.status === 'failed') failed += 1;
      else skipped += 1;
    }
  }

  return {
    scanned: ready.length,
    sent,
    retried,
    failed,
    skipped,
    recoveredStuck: recovered.count,
    ranAt,
  };
}
