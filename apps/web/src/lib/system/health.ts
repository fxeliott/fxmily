import 'server-only';

import { db } from '@/lib/db';

/**
 * J10 Phase J — Cron heartbeat health check.
 *
 * Every Fxmily cron emits a `cron.<route>.scan` audit row on each run.
 * If the most recent row is older than the cron's expected period (with
 * a tolerance multiplier), the cron is considered unhealthy and we
 * surface the gap to the operator (admin UI + GitHub Actions watcher).
 *
 * Why this design :
 *  - Audit logs are the canonical source of truth for "did the cron run".
 *    Sentry reports failures, but a cron that never fired (cron daemon
 *    crashed, secret mismatch, network broken) doesn't throw — it just
 *    doesn't write a row. The only way to detect "missing" is to look at
 *    the gap from `now`.
 *  - Each cron has its own period and tolerance. A weekly cron should not
 *    page when it's 23h behind ; an every-2-min cron should.
 *  - Tolerance multiplier (×3 by default) absorbs scheduling jitter +
 *    rolling deploys + network blips without false positives.
 */

interface CronExpectation {
  /** Audit action emitted by the route. */
  action:
    | 'cron.checkin_reminders.scan'
    | 'cron.recompute_scores.scan'
    | 'cron.dispatch_douglas.scan'
    | 'cron.weekly_reports.scan'
    | 'cron.dispatch_notifications.scan'
    | 'cron.purge_deleted.scan'
    | 'cron.purge_push_subscriptions.scan'
    | 'cron.purge_audit_log.scan'
    | 'cron.health.scan';
  /** Human-readable label for the dashboard. */
  label: string;
  /** Expected period in ms (matches the crontab schedule). */
  periodMs: number;
  /** Multiplier applied to `periodMs` to flag a gap as unhealthy. Default 3. */
  toleranceMultiplier?: number;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Source of truth : `ops/cron/crontab.fxmily`.
const EXPECTATIONS: readonly CronExpectation[] = [
  {
    action: 'cron.checkin_reminders.scan',
    label: 'Check-in reminders',
    periodMs: 15 * MIN, // every 15 min in the 7-9 AM + 8-10 PM UTC windows
    toleranceMultiplier: 80, // window-bounded, so allow up to ~20h between runs (off-window)
  },
  {
    action: 'cron.recompute_scores.scan',
    label: 'Behavioral score recompute',
    periodMs: DAY, // 02:00 UTC daily
  },
  {
    action: 'cron.dispatch_douglas.scan',
    label: 'Mark Douglas dispatch',
    periodMs: 6 * HOUR,
  },
  {
    action: 'cron.weekly_reports.scan',
    label: 'Weekly AI digest',
    periodMs: WEEK,
  },
  {
    action: 'cron.dispatch_notifications.scan',
    label: 'Web Push dispatcher',
    periodMs: 2 * MIN,
    toleranceMultiplier: 5, // burst-y by nature; allow 10 min gap
  },
  {
    action: 'cron.purge_deleted.scan',
    label: 'RGPD soft-delete purge',
    periodMs: DAY, // 03:00 UTC daily
  },
  {
    action: 'cron.purge_push_subscriptions.scan',
    label: 'Stale push subscriptions cleanup',
    periodMs: WEEK, // Sun 05:00 UTC
  },
  {
    // J10 V2-roadmap reclassed — audit_log retention 90j (daily 04:00 UTC).
    // Without this purge, the audit_logs table dominates write IOPS at the
    // 1000-member cohort. The cron is daily so default tolerance (×3) is
    // 72h before flagging red — gentler than the dispatcher (10 min).
    action: 'cron.purge_audit_log.scan',
    label: 'Audit log retention purge',
    periodMs: DAY, // 04:00 UTC daily
  },
  {
    // J10 Phase O fix B3 : self-monitor the watcher itself. If `cron-watch.yml`
    // (GitHub Actions hourly schedule) stops running, no `cron.health.scan`
    // audit row appears, and `getCronHealthReport` flags this entry red →
    // operator notices the watcher is broken on the next admin/system visit.
    // Without this entry the cron-watch promise of "self-monitoring" was
    // unkept (route handler emitted the audit row but no expectation
    // checked the gap).
    action: 'cron.health.scan',
    label: 'Health watcher heartbeat',
    periodMs: HOUR, // cron-watch.yml triggers at `15 * * * *`
    toleranceMultiplier: 4, // 4h gap before flagging red (covers GH Actions delay)
  },
] as const;

export type CronStatus = 'green' | 'amber' | 'red' | 'never_ran';

export interface CronHealthEntry {
  action: CronExpectation['action'];
  label: string;
  periodMs: number;
  /** ISO-8601 of the last successful scan, or null if no audit row at all. */
  lastRanAt: string | null;
  /** ms since the last scan, or null if never ran. */
  ageMs: number | null;
  /** Threshold beyond which we flag the cron as unhealthy. */
  toleranceMs: number;
  status: CronStatus;
}

export interface CronHealthReport {
  ranAt: string;
  /** Worst status across all crons (`red` > `amber` > `never_ran` > `green`). */
  overall: CronStatus;
  entries: CronHealthEntry[];
}

/**
 * Look up the most-recent `cron.*.scan` row for each known action and
 * compute its status.
 *
 * Single SQL pass (`groupBy` + `_max`) so the cost is constant regardless
 * of audit log volume — Postgres uses the `(action, created_at desc)`
 * index naturally.
 */
export async function getCronHealthReport(now: Date = new Date()): Promise<CronHealthReport> {
  const grouped = await db.auditLog.groupBy({
    by: ['action'],
    where: { action: { in: EXPECTATIONS.map((e) => e.action) } },
    _max: { createdAt: true },
  });

  const lastRanByAction = new Map<string, Date>();
  for (const row of grouped) {
    if (row._max.createdAt) lastRanByAction.set(row.action, row._max.createdAt);
  }

  const entries: CronHealthEntry[] = EXPECTATIONS.map((expectation) => {
    const lastRanAt = lastRanByAction.get(expectation.action) ?? null;
    const ageMs = lastRanAt ? now.getTime() - lastRanAt.getTime() : null;
    const toleranceMs = expectation.periodMs * (expectation.toleranceMultiplier ?? 3);

    let status: CronStatus;
    if (lastRanAt === null) {
      status = 'never_ran';
    } else if (ageMs === null) {
      status = 'never_ran';
    } else if (ageMs <= expectation.periodMs * 1.5) {
      status = 'green';
    } else if (ageMs <= toleranceMs) {
      status = 'amber';
    } else {
      status = 'red';
    }

    return {
      action: expectation.action,
      label: expectation.label,
      periodMs: expectation.periodMs,
      lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
      ageMs,
      toleranceMs,
      status,
    };
  });

  const overall: CronStatus = entries.some((e) => e.status === 'red')
    ? 'red'
    : entries.some((e) => e.status === 'never_ran')
      ? 'never_ran'
      : entries.some((e) => e.status === 'amber')
        ? 'amber'
        : 'green';

  return { ranAt: now.toISOString(), overall, entries };
}

/**
 * Aggregate counts useful on the admin dashboard alongside cron health.
 *
 * `Promise.all` 5 parallel `count()` queries — each hits a `userId` /
 * `status` index (verified). Constant cost regardless of cohort size.
 */
export interface SystemSnapshot {
  members: {
    active: number;
    deletionScheduled: number;
    softDeleted: number;
  };
  push: {
    activeSubscriptions: number;
  };
  audit: {
    last24h: number;
  };
}

export async function getSystemSnapshot(now: Date = new Date()): Promise<SystemSnapshot> {
  const last24h = new Date(now.getTime() - DAY);
  const [active, deletionScheduled, softDeleted, activeSubscriptions, audit24h] = await Promise.all(
    [
      db.user.count({ where: { status: 'active', deletedAt: null } }),
      db.user.count({ where: { status: 'active', deletedAt: { not: null } } }),
      db.user.count({ where: { status: 'deleted' } }),
      db.pushSubscription.count(),
      db.auditLog.count({ where: { createdAt: { gte: last24h } } }),
    ],
  );

  return {
    members: { active, deletionScheduled, softDeleted },
    push: { activeSubscriptions },
    audit: { last24h: audit24h },
  };
}
