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
 *   - bounded batch (default 5_000 rows) — each round-trip `deleteMany`
 *     keeps the transaction lock duration under a second on the 4 GB box ;
 *   - DRAIN LOOP (V2 hardening) — a SINGLE 5k batch/day cannot keep up with
 *     the ~15k rows/day churn at 1000 members (purge < intake → the table
 *     grows NET every day, defeating the whole purpose). We now loop the
 *     bounded delete until the backlog older than the threshold is drained
 *     OR a hard iteration cap is hit (keeps the run inside the cron
 *     `--max-time` budget and prevents a runaway on a delete that never
 *     shrinks). 40 × 5_000 = 200k rows/run — comfortably above the daily
 *     intake at the V1 member scale while staying well under the time box.
 *   - returns ACCUMULATED counts + threshold for the audit metadata.
 *
 * NOTE: this purge is destructive on a security-relevant table. The route
 * audit row (`cron.purge_audit_log.scan`) survives because it's written
 * AFTER the deleteMany loop completes — it's strictly newer than the cutoff.
 */

const RETENTION_DAYS = 90;
const DEFAULT_BATCH = 5_000;
// Hard cap on drain iterations per run. Bounds total work (200k rows) so the
// job always terminates inside the cron `--max-time` window even if intake
// momentarily spikes; the next daily run picks up any residual backlog.
const DEFAULT_MAX_BATCHES = 40;

export const AUDIT_LOG_RETENTION_DAYS = RETENTION_DAYS;

export interface PurgeAuditLogResult {
  thresholdDate: string;
  scanned: number;
  purged: number;
  errors: number;
  ranAt: string;
}

export async function purgeStaleAuditLog(
  options: { now?: Date; retentionDays?: number; batchSize?: number; maxBatches?: number } = {},
): Promise<PurgeAuditLogResult> {
  const now = options.now ?? new Date();
  const days = options.retentionDays ?? RETENTION_DAYS;
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;

  let scanned = 0;
  let purged = 0;
  let errors = 0;

  // Drain loop: keep deleting bounded batches until the stale backlog is
  // exhausted (a batch returns fewer rows than `batchSize`) or the hard
  // iteration cap is reached. Each iteration is the same two-step
  // (find IDs → deleteMany on those IDs) that keeps the batch cap honoured
  // (anti-lock-contention on audit_logs) while collapsing each delete to a
  // single round-trip. The (action, created_at desc) + (userId, created_at)
  // indexes help the WHERE planner; the SELECT sorts by `createdAt asc`.
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const candidates = await db.auditLog.findMany({
      where: { createdAt: { lt: threshold } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (candidates.length === 0) break;
    scanned += candidates.length;

    const ids = candidates.map((c) => c.id);
    try {
      const result = await db.auditLog.deleteMany({ where: { id: { in: ids } } });
      purged += result.count;
    } catch (err) {
      // Stop draining on a failing delete rather than spinning the cap —
      // surface the count so the heartbeat shows errors > 0.
      errors += candidates.length;
      console.error('[audit.cleanup] deleteMany failed', err);
      break;
    }

    // Drained: the last page was partial, so nothing older remains.
    if (candidates.length < batchSize) break;
  }

  return {
    thresholdDate: threshold.toISOString(),
    scanned,
    purged,
    errors,
    ranAt: now.toISOString(),
  };
}
