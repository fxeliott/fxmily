import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

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
  | 'cron.health.scan';

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
