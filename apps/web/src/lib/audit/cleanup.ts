import 'server-only';

import { db } from '@/lib/db';

/**
 * J10 — `/api/cron/purge-audit-log` service (V2-roadmap reclassed item).
 *
 * The `audit_logs` table is the single most write-heavy table in the system
 * (every auth event, trade lifecycle, push dispatch, cron scan and admin
 * action emits a row). At 1000 members × ~5 notifs/day × ~3 audit rows,
 * we land ~15k rows/day of churn, dominated by ephemeral cron metadata
 * that loses operator value past a few weeks.
 *
 * 90-day retention strikes a defensible balance :
 *   - covers RGPD §16 expectations for ops post-mortem (logs available
 *     for the 60-day window member deletion lifecycle plus a margin) ;
 *   - lets us ship a small Hetzner CX22 (4 GB RAM, 40 GB disk) for V1
 *     without provisioning extra storage for old rows ;
 *   - the (action, created_at desc) index keeps rolling-window queries
 *     fast as long as the working set stays bounded.
 *
 * Cron wiring : daily 04:00 UTC (1 hour after `purge-deleted` to avoid
 * I/O collision on the same Postgres instance).
 *
 * Same shape & defensive posture as `lib/push/cleanup.ts` :
 *   - bounded batch (default 5_000 rows) — single round-trip `deleteMany`
 *     so transaction lock duration stays under a second on the 4 GB box ;
 *   - returns counts + threshold for the audit metadata.
 *
 * NOTE: this purge is destructive on a security-relevant table. The route
 * audit row (`cron.purge_audit_log.scan`) survives because it's written
 * AFTER the deleteMany completes — it's strictly newer than the cutoff.
 */

const RETENTION_DAYS = 90;
const DEFAULT_BATCH = 5_000;

export const AUDIT_LOG_RETENTION_DAYS = RETENTION_DAYS;

export interface PurgeAuditLogResult {
  thresholdDate: string;
  scanned: number;
  purged: number;
  errors: number;
  ranAt: string;
}

export async function purgeStaleAuditLog(
  options: { now?: Date; retentionDays?: number; batchSize?: number } = {},
): Promise<PurgeAuditLogResult> {
  const now = options.now ?? new Date();
  const days = options.retentionDays ?? RETENTION_DAYS;
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = options.batchSize ?? DEFAULT_BATCH;

  // Two-step (find IDs, then deleteMany on those IDs) keeps the batch cap
  // honoured (anti-lock-contention on audit_logs) while collapsing the
  // delete to a single round-trip. The (action, created_at desc) index +
  // (userId, created_at) index both help the WHERE planner ; we don't need
  // a third index since the SELECT below sorts by `createdAt asc`.
  const candidates = await db.auditLog.findMany({
    where: { createdAt: { lt: threshold } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (candidates.length === 0) {
    return {
      thresholdDate: threshold.toISOString(),
      scanned: 0,
      purged: 0,
      errors: 0,
      ranAt: now.toISOString(),
    };
  }

  const ids = candidates.map((c) => c.id);
  let purged = 0;
  let errors = 0;
  try {
    const result = await db.auditLog.deleteMany({ where: { id: { in: ids } } });
    purged = result.count;
  } catch (err) {
    errors = candidates.length;
    console.error('[audit.cleanup] deleteMany failed', err);
  }

  return {
    thresholdDate: threshold.toISOString(),
    scanned: candidates.length,
    purged,
    errors,
    ranAt: now.toISOString(),
  };
}
