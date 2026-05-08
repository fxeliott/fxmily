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
 */

const STALE_DAYS = 90;

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
  const batchSize = options.batchSize ?? 500;

  // We scan in two predicates so a brand-new subscription whose `lastSeenAt`
  // is still NULL (created but no dispatch yet) is NOT purged on day 91.
  // Only subs that have been seen at least once but went silent past the
  // window are at risk — a never-seen sub stays around until it either
  // gets used or its row is replaced via `pushsubscriptionchange`.
  const candidates = await db.pushSubscription.findMany({
    where: {
      lastSeenAt: { lt: threshold },
    },
    select: { id: true },
    orderBy: { lastSeenAt: 'asc' },
    take: batchSize,
  });

  let deleted = 0;
  let errors = 0;
  for (const c of candidates) {
    try {
      await db.pushSubscription.delete({ where: { id: c.id } });
      deleted += 1;
    } catch (err) {
      errors += 1;
      console.error('[push.cleanup] delete failed for', c.id, err);
    }
  }

  return {
    staleThreshold: threshold.toISOString(),
    scanned: candidates.length,
    deleted,
    errors,
    ranAt: now.toISOString(),
  };
}
