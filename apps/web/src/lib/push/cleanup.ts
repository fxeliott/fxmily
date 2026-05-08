import 'server-only';

import { db } from '@/lib/db';

/**
 * J10 — `/api/cron/purge-push-subscriptions` service (J9 reclassed item).
 *
 * Web Push subscriptions can become stale silently :
 *  - the user uninstalled the PWA (no `pushsubscriptionchange` fires when
 *    the SW is gone) ;
 *  - the device hasn't connected to FCM/APNs in months (Mozilla's iOS
 *    fragility window — push fail loops cap our retry budget at 3) ;
 *  - the iOS standalone state was disabled and the SW disposed.
 *
 * `lastSeenAt` is bumped on every successful dispatch and on every
 * `pushsubscriptionchange` resubscribe. If a row's `lastSeenAt` is older
 * than 90 days, it's almost certainly dead weight. Removing it keeps the
 * dispatcher fan-out fast and shrinks the WHERE-clause working set as the
 * cohort grows.
 *
 * Privacy bonus : pruning subscriptions also reduces the surface of any
 * future SSRF amplifier vector (each endpoint is a callable URL).
 *
 * J10 Phase J — performance-profiler T2.1 fix : the previous N+1 loop
 * (one `delete` per row) was replaced by a single `deleteMany` — gain
 * ~500x latency at the 500-row weekly batch.
 */

const STALE_DAYS = 90;
const DEFAULT_BATCH = 500;

export const PUSH_SUBSCRIPTION_STALE_DAYS = STALE_DAYS;

export interface PurgeStaleSubscriptionsResult {
  staleThreshold: string;
  scanned: number;
  deleted: number;
  errors: number;
  ranAt: string;
}

export async function purgeStalePushSubscriptions(
  options: { now?: Date; staleDays?: number; batchSize?: number } = {},
): Promise<PurgeStaleSubscriptionsResult> {
  const now = options.now ?? new Date();
  const days = options.staleDays ?? STALE_DAYS;
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = options.batchSize ?? DEFAULT_BATCH;

  // Two-step pattern (find IDs then deleteMany on those IDs) keeps the
  // batch cap honoured (anti-lock-contention on push_subscriptions) while
  // collapsing N round-trips into 2. NULL `lastSeenAt` values are NEVER
  // selected because Postgres treats `NULL < timestamp` as `NULL` (false),
  // preserving never-seen-yet subscriptions past day 91 — which is the
  // intended semantics for fresh subs that haven't been dispatched to yet.
  const candidates = await db.pushSubscription.findMany({
    where: { lastSeenAt: { lt: threshold } },
    select: { id: true },
    orderBy: { lastSeenAt: 'asc' },
    take: batchSize,
  });

  if (candidates.length === 0) {
    return {
      staleThreshold: threshold.toISOString(),
      scanned: 0,
      deleted: 0,
      errors: 0,
      ranAt: now.toISOString(),
    };
  }

  const ids = candidates.map((c) => c.id);
  let deleted = 0;
  let errors = 0;
  try {
    const result = await db.pushSubscription.deleteMany({ where: { id: { in: ids } } });
    deleted = result.count;
  } catch (err) {
    errors = candidates.length;
    console.error('[push.cleanup] deleteMany failed', err);
  }

  return {
    staleThreshold: threshold.toISOString(),
    scanned: candidates.length,
    deleted,
    errors,
    ranAt: now.toISOString(),
  };
}
