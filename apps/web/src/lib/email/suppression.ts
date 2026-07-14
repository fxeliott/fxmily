import 'server-only';

import { db } from '@/lib/db';

/**
 * J2 — email suppression list.
 *
 * When Resend tells us (via the `/api/webhooks/resend` webhook) that an address
 * hard-bounced or filed a spam complaint, we record it here. `sendEmail` then
 * refuses to re-send to that address, which protects the shared sending
 * reputation of the free-tier domain. The address is the natural primary key,
 * always stored lowercase so lookups are case-insensitive.
 */

/** The two reasons an address ends up suppressed. */
export type SuppressionReason = 'hard_bounce' | 'complaint';

/** Trim + lowercase so `Foo@Bar.COM` and `foo@bar.com` collapse to one key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `true` iff the address is on the suppression list. */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const row = await db.emailSuppression.findUnique({
    where: { email: normalizeEmail(email) },
    select: { email: true },
  });
  return row !== null;
}

export interface UpsertSuppressionInput {
  email: string;
  reason: SuppressionReason;
  bounceType?: string | null;
  bounceSubType?: string | null;
  resendEmailId?: string | null;
  userId?: string | null;
}

/**
 * Add (or refresh) a suppression entry. Idempotent: replaying the same webhook
 * event just re-writes the same row. Optional metadata is coerced to `null`
 * (never `undefined`) so it satisfies `exactOptionalPropertyTypes`.
 */
export async function upsertSuppression(input: UpsertSuppressionInput): Promise<void> {
  const email = normalizeEmail(input.email);
  const data = {
    reason: input.reason,
    bounceType: input.bounceType ?? null,
    bounceSubType: input.bounceSubType ?? null,
    resendEmailId: input.resendEmailId ?? null,
    userId: input.userId ?? null,
  };
  await db.emailSuppression.upsert({
    where: { email },
    create: { email, ...data },
    update: data,
  });
}
