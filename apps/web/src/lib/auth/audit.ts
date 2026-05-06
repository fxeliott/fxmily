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
  | 'checkin.reminder.scan';

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
