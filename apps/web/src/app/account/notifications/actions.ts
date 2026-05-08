'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { setPreference } from '@/lib/push/preferences';
import {
  deleteAllPushSubscriptionsForUser,
  deletePushSubscriptionByEndpoint,
  TooManySubscriptionsError,
  upsertPushSubscription,
} from '@/lib/push/service';
import {
  pushSubscriptionInputSchema,
  togglePreferenceInputSchema,
  unsubscribePushInputSchema,
} from '@/lib/schemas/push-subscription';

/**
 * Server Actions backing `/account/notifications` (J9).
 *
 * Three actions:
 *  - `subscribePushAction(rawJson)` — receive `subscription.toJSON()` from the
 *    browser, parse, persist (upsert on userId+endpoint), audit. Bumps
 *    `lastSeenAt`. Returns `{ ok, created? }` for the client island to update
 *    its UI optimistically.
 *  - `unsubscribePushAction(endpoint)` — delete this device's subscription.
 *    Idempotent (count=0 if not found). Audit row only when something was
 *    actually deleted.
 *  - `togglePreferenceAction({ type, enabled })` — flip a per-category toggle.
 *    Always audits the toggle (whether it created the row or just flipped).
 *
 * Auth posture: every action re-checks `session.user.id !== undefined &&
 * session.user.status === 'active'`. Suspended members can't subscribe (the
 * dispatcher would skip them anyway, but defense in depth).
 *
 * NEVER returns the raw subscription endpoint or crypto keys — only counts
 * and IDs (endpoint enumeration risk per SPEC §16).
 */

type ActionResult =
  | { ok: true; message?: string }
  | { ok: true; created: boolean }
  | { ok: false; error: string };

async function getActiveUserOrFail(): Promise<
  { ok: true; userId: string; userAgent: string | null } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const hdrs = await headers();
  const ua = hdrs.get('user-agent');
  return { ok: true, userId: session.user.id, userAgent: ua };
}

export async function subscribePushAction(rawJson: unknown): Promise<ActionResult> {
  const ctx = await getActiveUserOrFail();
  if (!ctx.ok) return ctx;

  const parsed = pushSubscriptionInputSchema.safeParse(rawJson);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_subscription' };
  }

  let id: string;
  let created: boolean;
  try {
    const result = await upsertPushSubscription(ctx.userId, parsed.data, ctx.userAgent);
    id = result.id;
    created = result.created;
  } catch (err) {
    if (err instanceof TooManySubscriptionsError) {
      return { ok: false, error: 'too_many_devices' };
    }
    throw err;
  }

  await logAudit({
    action: created ? 'push.subscription.created' : 'push.subscription.updated',
    userId: ctx.userId,
    metadata: {
      subscriptionId: id,
      // NEVER log the endpoint URL itself — quasi-PII (identifies device).
    },
  });

  revalidatePath('/account/notifications');
  return { ok: true, created };
}

export async function unsubscribePushAction(input: { endpoint: string }): Promise<ActionResult> {
  const ctx = await getActiveUserOrFail();
  if (!ctx.ok) return ctx;

  const parsed = unsubscribePushInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_endpoint' };
  }

  const count = await deletePushSubscriptionByEndpoint(ctx.userId, parsed.data.endpoint);

  if (count > 0) {
    await logAudit({
      action: 'push.subscription.deleted',
      userId: ctx.userId,
      metadata: { count },
    });
  }

  revalidatePath('/account/notifications');
  return { ok: true };
}

export async function unsubscribeAllPushAction(): Promise<ActionResult> {
  const ctx = await getActiveUserOrFail();
  if (!ctx.ok) return ctx;

  const count = await deleteAllPushSubscriptionsForUser(ctx.userId);

  if (count > 0) {
    await logAudit({
      action: 'push.subscription.deleted',
      userId: ctx.userId,
      metadata: { count, scope: 'all_devices' },
    });
  }

  revalidatePath('/account/notifications');
  return { ok: true };
}

export async function togglePreferenceAction(input: {
  type: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const ctx = await getActiveUserOrFail();
  if (!ctx.ok) return ctx;

  const parsed = togglePreferenceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_preference' };
  }

  await setPreference(ctx.userId, parsed.data.type, parsed.data.enabled);

  await logAudit({
    action: 'push.preference.toggled',
    userId: ctx.userId,
    metadata: { type: parsed.data.type, enabled: parsed.data.enabled },
  });

  revalidatePath('/account/notifications');
  return { ok: true };
}

/**
 * Audit-only action — called from the client when the browser permission
 * prompt resolves. Lets us track granted vs denied funnel without polluting
 * the subscription/preference paths.
 */
export async function logPermissionDecisionAction(decision: 'granted' | 'denied'): Promise<void> {
  const ctx = await getActiveUserOrFail();
  if (!ctx.ok) return;
  await logAudit({
    action: decision === 'granted' ? 'push.permission.granted' : 'push.permission.denied',
    userId: ctx.userId,
  });
}
