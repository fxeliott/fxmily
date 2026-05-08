import 'server-only';

import { db } from '@/lib/db';
import type { PushSubscriptionInput } from '@/lib/schemas/push-subscription';
import { safeFreeText } from '@/lib/text/safe';

/**
 * Hard cap on the number of active subscriptions per user. Prevents abuse
 * (a malicious or buggy client spamming `subscribePushAction` with synthetic
 * endpoints to amplify dispatcher cost). 10 covers realistic usage:
 * 1 phone + 1 desktop + 1 tablet + replacements (Apple ITP can churn the
 * subscription on iOS Safari). Beyond 10, the action returns
 * `too_many_devices` and the member must `unsubscribeAllPushAction` first.
 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export class TooManySubscriptionsError extends Error {
  constructor() {
    super('too_many_subscriptions');
    this.name = 'TooManySubscriptionsError';
  }
}

/**
 * Push subscription persistence layer (J9).
 *
 * Three responsibilities:
 * 1. `upsertPushSubscription` — used by both initial subscribe and
 *    `pushsubscriptionchange` re-subscribe. Composite unique on
 *    `(userId, endpoint)` makes it safe under concurrent calls (P2002 caught
 *    by an explicit upsert; we never throw on dup).
 * 2. `deletePushSubscriptionByEndpoint` — used by the `<PushToggle>` opt-out
 *    AND by the dispatcher when a 404/410 Gone arrives from the push service
 *    (the endpoint became invalid; remove without ceremony).
 * 3. `listSubscriptionsForUser` — returns the active devices for the dispatcher
 *    AND the count for the `/account/notifications` UI ("3 appareils
 *    abonnés").
 *
 * **Endpoint enumeration risk** (SPEC §16): the UI MUST NEVER expose raw
 * endpoints to the member-facing page — only counts and last-seen timestamps.
 * The endpoint is treated as quasi-PII (identifies a unique browser/device).
 * Admin-only views (J10) may show it for debug.
 *
 * **lastSeenAt** is bumped each time the dispatcher successfully sends OR the
 * subscription gets re-pushed via `pushsubscriptionchange`. A separate cron
 * (`0 5 * * 0` UTC, J9.5+) will delete rows where `lastSeenAt < now - 90j`
 * for RGPD data minimization.
 */

/// Public DTO for the member-facing notifications page. NEVER includes the
/// raw endpoint URL. `id` is exposed because the UI uses it in delete forms,
/// but the actual ownership check happens server-side via `userId == session`.
export type SafeSubscriptionView = {
  id: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
};

/**
 * Sanitize a captured UA string before persistence. NFC normalize + bidi/zero-width
 * strip (`safeFreeText`) protects against Trojan Source / log spoofing if the
 * UA later renders in admin views. Truncated to 2048 chars.
 */
function sanitizeUserAgent(ua: string | null): string | null {
  if (ua === null) return null;
  return safeFreeText(ua).slice(0, 2048);
}

export async function upsertPushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<{ id: string; created: boolean }> {
  // We need to know if it was created vs updated for the audit log.
  const existing = await db.pushSubscription.findUnique({
    where: { userId_endpoint: { userId, endpoint: input.endpoint } },
    select: { id: true },
  });

  const cleanUa = sanitizeUserAgent(userAgent);

  if (existing) {
    const updated = await db.pushSubscription.update({
      where: { id: existing.id },
      data: {
        p256dhKey: input.keys.p256dh,
        authKey: input.keys.auth,
        userAgent: cleanUa,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  // Cap active subscriptions per user (anti-amplification of dispatcher cost).
  const activeCount = await db.pushSubscription.count({ where: { userId } });
  if (activeCount >= MAX_SUBSCRIPTIONS_PER_USER) {
    throw new TooManySubscriptionsError();
  }

  const created = await db.pushSubscription.create({
    data: {
      userId,
      endpoint: input.endpoint,
      p256dhKey: input.keys.p256dh,
      authKey: input.keys.auth,
      userAgent: cleanUa,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Delete a subscription by (userId, endpoint). Used by:
 * - The member opt-out flow (`unsubscribePushAction`).
 * - The dispatcher on 404/410 Gone from the push service.
 *
 * Returns the count of deleted rows (0 if the endpoint was unknown — silent
 * success, idempotent).
 */
export async function deletePushSubscriptionByEndpoint(
  userId: string,
  endpoint: string,
): Promise<number> {
  const result = await db.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
  return result.count;
}

/**
 * Delete all subscriptions for a user (admin tool / member self-purge).
 * Returns the count.
 */
export async function deleteAllPushSubscriptionsForUser(userId: string): Promise<number> {
  const result = await db.pushSubscription.deleteMany({ where: { userId } });
  return result.count;
}

/**
 * Returns the safe member-facing view of all active subscriptions for the
 * given user. Excludes the raw endpoint + crypto keys — only metadata and IDs.
 */
export async function listSafeSubscriptionsForUser(
  userId: string,
): Promise<SafeSubscriptionView[]> {
  const rows = await db.pushSubscription.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Internal helper for the dispatcher (J9 phase C) — returns the raw rows
 * including endpoint + keys needed for `web-push.sendNotification`. This
 * function is server-only and NEVER reachable from a member-facing API.
 */
export async function listDispatchableSubscriptionsForUser(userId: string): Promise<
  Array<{
    id: string;
    endpoint: string;
    p256dhKey: string;
    authKey: string;
  }>
> {
  return db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dhKey: true, authKey: true },
  });
}

/**
 * Bump `lastSeenAt` to NOW for the given subscription. Called by the
 * dispatcher after a successful send.
 */
export async function bumpSubscriptionLastSeen(id: string): Promise<void> {
  await db.pushSubscription
    .update({
      where: { id },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    })
    .catch(() => {
      // Race: subscription was deleted between dispatch and bump. No-op.
    });
}
