import 'server-only';

import { db } from '@/lib/db';
import { localDateOf } from '@/lib/checkin/timezone';

/**
 * J2 — atomic daily Resend send counter (piège J2 : PAS in-memory).
 *
 * Resend's free tier caps outbound email at 100/day. We enforce that cap at the
 * database level so it survives process restarts and stays correct under the
 * concurrent cron dispatchers (weekly reports, monthly debriefs, push email
 * fallback, …) that all funnel through `sendEmail`.
 *
 * `reserveDailySend` performs a single atomic statement:
 *
 *   INSERT … VALUES (day, 1) ON CONFLICT (day) DO UPDATE
 *     SET count = count + 1 WHERE count < CAP RETURNING count
 *
 * When the day's row is already at the cap, the `WHERE count < CAP` guard makes
 * the UPDATE a no-op and `RETURNING` yields zero rows → the send is refused
 * cleanly. There is no read-then-write race: the increment and the cap check are
 * one round-trip.
 *
 * The reservation happens BEFORE the actual Resend call: over-counting on a
 * later send failure is conservative (we might refuse one legitimate email near
 * the cap), whereas under-counting would breach Resend's hard limit and get the
 * whole account throttled.
 */

/** Resend free-tier hard cap: 100 emails per calendar day. */
export const RESEND_DAILY_CAP = 100;

/** Alert threshold: warn once when the day's count crosses 80 % of the cap. */
export const RESEND_DAILY_ALERT_THRESHOLD = 80;

export interface ReserveDailySendResult {
  /** `true` when the send may proceed, `false` when the daily cap is reached. */
  ok: boolean;
  /** The day's count AFTER this reservation (equals the cap when refused). */
  count: number;
  /** `true` when the cap was already reached and the send must be refused. */
  capped: boolean;
}

/** The Paris-local calendar day key (`YYYY-MM-DD`) used as the counter's PK. */
export function currentParisSendDay(now: Date = new Date()): string {
  return localDateOf(now, 'Europe/Paris');
}

/**
 * Atomically reserve one slot in today's send budget.
 *
 * @returns `{ ok: false, capped: true }` when the daily cap is reached (refuse
 *   the send), otherwise `{ ok: true, count }` where `count` is the running
 *   total after this reservation.
 */
export async function reserveDailySend(now: Date = new Date()): Promise<ReserveDailySendResult> {
  const day = currentParisSendDay(now);

  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO email_send_counters (day, count, updated_at)
    VALUES (${day}, 1, NOW())
    ON CONFLICT (day) DO UPDATE
      SET count = email_send_counters.count + 1, updated_at = NOW()
      WHERE email_send_counters.count < ${RESEND_DAILY_CAP}
    RETURNING count
  `;

  const first = rows[0];
  if (first === undefined) {
    // Empty RETURNING → the `WHERE count < CAP` guard blocked the UPDATE.
    return { ok: false, count: RESEND_DAILY_CAP, capped: true };
  }

  return { ok: true, count: Number(first.count), capped: false };
}

/** Read today's send count without reserving (for the `/admin/system` widget). */
export async function getDailySendCount(now: Date = new Date()): Promise<number> {
  const day = currentParisSendDay(now);
  const row = await db.emailSendCounter.findUnique({
    where: { day },
    select: { count: true },
  });
  return row?.count ?? 0;
}
