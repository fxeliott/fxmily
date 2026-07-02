'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { updateTimezoneInputSchema } from '@/lib/schemas/timezone';

/**
 * Server Action backing `/account/timezone` (F2 — per-member timezone).
 *
 * `updateTimezoneAction({ timezone })` — persist the member's IANA timezone.
 * The new value reaches the live session within one request because the
 * Node-side `jwt` callback (`auth.ts` -> `refreshAndCheckToken`) re-reads
 * `timezone` from the DB on every `auth()` call (F2 plumbing) — no re-login
 * required and NO `session.update()` path is reopened (the H3 privilege-
 * escalation hole stays closed; only the server controls the claim).
 *
 * Auth posture mirrors `/account/notifications`: re-check
 * `session.user.id && status === 'active'` server-side. Suspended members
 * cannot mutate their profile.
 *
 * The new value is guarded against later degradation by the strict allowlist
 * in `updateTimezoneInputSchema` (a non-IANA string would silently fall back
 * to UTC in the core time-lib, so it must never reach the column).
 */

type ActionResult = { ok: true; timezone: string } | { ok: false; error: string };

async function getActiveUserIdOrFail(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, userId: session.user.id };
}

export async function updateTimezoneAction(input: { timezone: string }): Promise<ActionResult> {
  const ctx = await getActiveUserIdOrFail();
  if (!ctx.ok) return ctx;

  const parsed = updateTimezoneInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_timezone' };
  }

  await db.user.update({
    where: { id: ctx.userId },
    data: { timezone: parsed.data.timezone },
  });

  await logAudit({
    action: 'account.timezone.updated',
    userId: ctx.userId,
    metadata: { timezone: parsed.data.timezone },
  });

  // The settings page re-reads the column; the dashboard hero + member surfaces
  // derive "today"/greeting from the timezone, so refresh both. Most member
  // pages are `force-dynamic` (re-render per request) and pick up the new
  // session timezone automatically.
  revalidatePath('/account/timezone');
  revalidatePath('/dashboard');

  return { ok: true, timezone: parsed.data.timezone };
}
