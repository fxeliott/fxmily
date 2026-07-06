'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { formatOffDayLabel } from '@/lib/checkin/off-day-label';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';
import {
  OFF_DAY_CANCEL_BACK_HORIZON_DAYS,
  OFF_DAY_FORWARD_HORIZON_DAYS,
  cancelOffDaySchema,
  declareOffDayRangeSchema,
  declareOffDaySchema,
} from '@/lib/schemas/off-day';

/**
 * Server Actions for the "jour off" (off-day) surface (Tour 14, SPEC pont).
 *
 * `declareOffDayAction(date?, reason?)` — the member declares a day off
 *   (default: today, member-local). Upserts on the `(userId, date)` unique key
 *   so re-declaring the same day is idempotent (updates the reason, never a
 *   duplicate row).
 * `cancelOffDayAction(date)` — the member takes the declaration back. A delete
 *   on `(userId, date)`; an already-absent row is a no-op success (idempotent,
 *   anti-enum: "cancel a day that was never off" is not an error to surface).
 *   Cancelling is allowed a little into the PAST (up to 7 days) so a mislabelled
 *   recent day can be corrected (review P2) — distinct from the forward-only
 *   DECLARE window.
 * `declareOffDayRangeAction(from, to, reason?)` — the member declares a whole
 *   span off (vacances). One idempotent upsert per civil day in a single
 *   transaction (bounded ≤31 days by the schema), so a partial failure never
 *   leaves a half-declared range.
 * `updateWeekendsOffAction(value)` — the member toggles whether weekends count
 *   as off by default (`User.weekendsOff`).
 *
 * Pattern carbone `account/timezone/actions.ts#updateTimezoneAction` +
 * `objectifs/actions.ts#closeMicroObjectiveAction`:
 *   - re-call `auth()` + `status === 'active'` (defence in depth on top of the proxy);
 *   - re-validate the positional args with the strict Zod schema;
 *   - re-assert the date window TZ-aware in the member's OWN timezone (Zod is a
 *     UTC first pass — see `off-day.ts`); a past day / a day beyond +30 is rejected;
 *   - direct `db.memberOffDay` write scoped to the session user (no BOLA surface —
 *     the row is keyed on the authenticated id, never a caller-supplied userId);
 *   - PII-free audit (opaque date only — the free-text reason is never logged);
 *   - `revalidatePath` the member surfaces that derive off-day state.
 */

export type OffDayActionState =
  | { ok: true; date: string }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'unknown' };

/**
 * TZ-aware second pass: the day must sit in `[today, today+30]` in the MEMBER's
 * timezone. `LocalDateString`s are ISO-8601, so the lexicographic string
 * comparison is a correct calendar comparison. Returns the clamped bounds so a
 * rejection message can stay generic (we never leak the exact server "today").
 */
function isWithinMemberWindow(date: string, timezone: string): boolean {
  const today = localDateOf(new Date(), timezone);
  const upper = shiftLocalDate(today, OFF_DAY_FORWARD_HORIZON_DAYS);
  return date >= today && date <= upper;
}

/**
 * TZ-aware CANCEL window: `[today−7, today+30]` in the MEMBER's timezone. Wider
 * on the past side than the declare window so a member can undo a recent
 * mislabelled off day (review P2). Same lexicographic ISO-date comparison.
 */
function isWithinCancelWindow(date: string, timezone: string): boolean {
  const today = localDateOf(new Date(), timezone);
  const lower = shiftLocalDate(today, -OFF_DAY_CANCEL_BACK_HORIZON_DAYS);
  const upper = shiftLocalDate(today, OFF_DAY_FORWARD_HORIZON_DAYS);
  return date >= lower && date <= upper;
}

export async function declareOffDayAction(
  date?: string,
  reason?: string,
): Promise<OffDayActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const timezone = session.user.timezone || 'Europe/Paris';

  // Default to today, member-local, when the caller omits the date.
  const rawDate = date ?? localDateOf(new Date(), timezone);
  const parsed = declareOffDaySchema.safeParse({ date: rawDate, reason });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  // TZ-aware window (the Zod pass is UTC-tolerant; this is the member-local truth).
  if (!isWithinMemberWindow(parsed.data.date, timezone)) {
    return { ok: false, error: 'invalid_input' };
  }

  const dateValue = parseLocalDate(parsed.data.date);
  try {
    await db.memberOffDay.upsert({
      where: { userId_date: { userId: session.user.id, date: dateValue } },
      create: { userId: session.user.id, date: dateValue, reason: parsed.data.reason },
      update: { reason: parsed.data.reason },
    });
  } catch (err) {
    reportWarning('checkin.off_day.declare', 'upsert_failed', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'checkin.off_day.declared',
    userId: session.user.id,
    // PII-free: the opaque civil date + whether a reason was given, never the text.
    metadata: { date: parsed.data.date, hasReason: parsed.data.reason !== null },
  });

  // The off day changes the streak/reminder/scoring surfaces + any calendar view.
  revalidatePath('/checkin');
  revalidatePath('/dashboard');

  return { ok: true, date: parsed.data.date };
}

export async function cancelOffDayAction(date: string): Promise<OffDayActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const timezone = session.user.timezone || 'Europe/Paris';

  const parsed = cancelOffDaySchema.safeParse({ date });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  // Cancel allows the widened past window (up to 7 days back), TZ-aware.
  if (!isWithinCancelWindow(parsed.data.date, timezone)) {
    return { ok: false, error: 'invalid_input' };
  }

  const dateValue = parseLocalDate(parsed.data.date);
  try {
    // `deleteMany` (not `delete`) so an already-absent row is a no-op instead of
    // a P2025 throw — cancelling a day that was never off is an idempotent success.
    // Scoped to the session user, so it can never touch another member's row.
    await db.memberOffDay.deleteMany({
      where: { userId: session.user.id, date: dateValue },
    });
  } catch (err) {
    reportWarning('checkin.off_day.cancel', 'delete_failed', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'checkin.off_day.cancelled',
    userId: session.user.id,
    metadata: { date: parsed.data.date },
  });

  revalidatePath('/checkin');
  revalidatePath('/dashboard');

  return { ok: true, date: parsed.data.date };
}

/** Result of a range declaration — the inclusive bounds that were written. */
export type OffDayRangeActionState =
  | {
      ok: true;
      from: string;
      to: string;
      days: number;
      /**
       * The written days with their server-formatted labels (Tour 15), so the
       * client list can update immediately — a member who posts an absence must
       * SEE it appear without reloading (prod-proven gap: the row only showed on
       * the next navigation). Same formatter as the `/account/rythme` SSR pass.
       */
      upcoming: Array<{ date: string; label: string; reason: string | null }>;
    }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'unknown' };

export async function declareOffDayRangeAction(
  from: string,
  to: string,
  reason?: string,
): Promise<OffDayRangeActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const timezone = session.user.timezone || 'Europe/Paris';

  const parsed = declareOffDayRangeSchema.safeParse({ from, to, reason });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  // TZ-aware clamp: BOTH bounds must sit in the member-local declare window.
  if (
    !isWithinMemberWindow(parsed.data.from, timezone) ||
    !isWithinMemberWindow(parsed.data.to, timezone)
  ) {
    return { ok: false, error: 'invalid_input' };
  }

  // Enumerate the civil days of the inclusive span (bounded ≤31 by the schema).
  const dates: string[] = [];
  for (let d = parsed.data.from; d <= parsed.data.to; d = shiftLocalDate(d, 1)) {
    dates.push(d);
  }

  try {
    // One transaction, one idempotent upsert per day: re-declaring an existing
    // day updates its reason (never a duplicate row), and a partial failure
    // rolls the whole span back so the member never sees a half-declared range.
    await db.$transaction(
      dates.map((d) => {
        const dateValue = parseLocalDate(d);
        return db.memberOffDay.upsert({
          where: { userId_date: { userId: session.user!.id, date: dateValue } },
          create: { userId: session.user!.id, date: dateValue, reason: parsed.data.reason },
          update: { reason: parsed.data.reason },
        });
      }),
    );
  } catch (err) {
    reportWarning('checkin.off_day.declare_range', 'upsert_failed', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'checkin.off_day.range_declared',
    userId: session.user.id,
    // PII-free: opaque bounds + day count + whether a reason was given.
    metadata: {
      from: parsed.data.from,
      to: parsed.data.to,
      days: dates.length,
      hasReason: parsed.data.reason !== null,
    },
  });

  revalidatePath('/checkin');
  revalidatePath('/dashboard');
  revalidatePath('/account');

  return {
    ok: true,
    from: parsed.data.from,
    to: parsed.data.to,
    days: dates.length,
    upcoming: dates.map((d) => ({
      date: d,
      label: formatOffDayLabel(parseLocalDate(d)),
      reason: parsed.data.reason,
    })),
  };
}

/** Result of the weekends-off toggle — the value that is now persisted. */
export type WeekendsOffActionState =
  | { ok: true; weekendsOff: boolean }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'unknown' };

export async function updateWeekendsOffAction(value: boolean): Promise<WeekendsOffActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  // The arg crosses a Server Action boundary — never trust the wire type.
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { weekendsOff: value },
    });
  } catch (err) {
    reportWarning('checkin.off_day.weekends', 'update_failed', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'checkin.off_day.weekends_updated',
    userId: session.user.id,
    metadata: { weekendsOff: value },
  });

  // Weekends-off changes the streak/reminder/scoring surfaces app-wide.
  revalidatePath('/checkin');
  revalidatePath('/dashboard');
  revalidatePath('/account');

  return { ok: true, weekendsOff: value };
}
