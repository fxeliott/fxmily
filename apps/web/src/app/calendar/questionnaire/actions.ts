'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  CALENDAR_SLOTS,
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKEND_DAYS,
} from '@/lib/calendar/instrument-v1';
import { submitWeeklyScheduleQuestionnaire } from '@/lib/calendar/service';
import { currentParisWeekStart } from '@/lib/calendar/week';
import { reportError } from '@/lib/observability';
import { submitWeeklyScheduleInputSchema } from '@/lib/schemas/weekly-schedule-questionnaire';

/**
 * §26 Calendrier adaptatif — Server Action for the weekly-schedule
 * questionnaire (J-C3). Carbon of `app/mindset/actions.ts` (V1.5 §27) +
 * `app/checkin/actions.ts` (J5).
 *
 * Server is the only authority:
 *   - `weekStart` is recomputed SERVER-side via `currentParisWeekStart()`
 *     (Europe/Paris) — the client-supplied hidden input is ignored entirely
 *     (anti-flake PR#96: never trust a client instant for a `@db.Date`).
 *   - the answers are rebuilt from the frozen instrument's vocabulary (the
 *     availability grid + the 7 closed items) and re-validated by
 *     `submitWeeklyScheduleInputSchema.strict()` — an unknown/extra key is
 *     structurally impossible.
 *   - `coerceBool` defeats the `Boolean('false') === true` footgun on the grid
 *     toggles (each travels as the literal string 'true'/'false').
 *
 * ZERO free-text (closed instrument, §26 Q4 default) → NO crisis-routing /
 * prompt-injection corpus to scan, and NO EU AI Act banner on THIS form (that
 * banner belongs to J-C4 on the GENERATED calendar). §2 posture: organises the
 * member's TIME of practice, never the market.
 *
 * Redirect: `/dashboard?done=questionnaire`. DELIBERATE divergence from the
 * J-C3 brief's `/calendrier?done=questionnaire` — `/calendrier` is the J-C4
 * surface and does NOT exist yet, so redirecting there would land on
 * `not-found`. The `/dashboard` widget shows the "rempli" confirmation. J-C4
 * may re-point this once `/calendrier` ships.
 */

export interface CalendarQuestionnaireActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
}

function flattenFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

function getString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Robust boolean coercion for the hidden grid toggles. `z.coerce.boolean()` is
 * broken (`Boolean('false') === true`), so we read the literal string only —
 * 'true'/'on'/'1'/'yes' is true, everything else (incl. 'false'/'') is false.
 */
function coerceBool(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'on' || s === '1' || s === 'yes';
}

function buildGrid(
  formData: FormData,
  prefix: string,
  days: readonly string[],
): Record<string, Record<string, boolean>> {
  const grid: Record<string, Record<string, boolean>> = {};
  for (const day of days) {
    const slots: Record<string, boolean> = {};
    for (const slot of CALENDAR_SLOTS) {
      slots[slot] = coerceBool(formData, `${prefix}.${day}.${slot}`);
    }
    grid[day] = slots;
  }
  return grid;
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function submitCalendarQuestionnaireAction(
  _prev: CalendarQuestionnaireActionState | null,
  formData: FormData,
): Promise<CalendarQuestionnaireActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  // weekStart is SERVER-authoritative — never the client hidden input.
  const weekStart = currentParisWeekStart();

  // Rebuild the closed answers. Enum/integer values pass through verbatim and
  // are validated by the Zod schema; an empty `constraint` becomes `undefined`
  // so the schema's `.default('none')` applies (an empty string would NOT be a
  // valid enum member and would fail).
  const sessionGoalRaw = getString(formData, 'sessionGoal');
  const constraintRaw = getString(formData, 'constraint');
  const responses = {
    profile: getString(formData, 'profile'),
    sessionGoal: Number.parseInt(sessionGoalRaw, 10),
    weekdayAvailability: buildGrid(formData, 'weekday', CALENDAR_WEEKDAYS),
    weekendAvailability: buildGrid(formData, 'weekend', CALENDAR_WEEKEND_DAYS),
    sleep: getString(formData, 'sleep'),
    energyPeak: getString(formData, 'energyPeak'),
    meetingCommitment: getString(formData, 'meetingCommitment'),
    practiceFocus: getString(formData, 'practiceFocus'),
    ...(constraintRaw ? { constraint: constraintRaw } : {}),
  };

  const parsed = submitWeeklyScheduleInputSchema.safeParse({ weekStart, responses });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let result;
  try {
    result = await submitWeeklyScheduleQuestionnaire(session.user.id, parsed.data);
  } catch (err) {
    reportError('calendar.questionnaire.submit', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  // PII-free: ids + week + version + bool, never the responses payload.
  await logAudit({
    action: 'calendar.questionnaire.submitted',
    userId: session.user.id,
    metadata: {
      weekStart: result.questionnaire.weekStart,
      instrumentVersion: result.questionnaire.instrumentVersion,
      wasNew: result.wasNew,
    },
  });

  // The calendar surface (J-C4) + the dashboard widget both reflect the new
  // questionnaire. `/calendrier` does not exist yet — revalidating it is a
  // harmless no-op and keeps this forward-compatible with J-C4.
  revalidatePath('/calendrier');
  revalidatePath('/dashboard');

  // Calm reveal, anti Black-Hat (§26): no score/streak in the URL.
  try {
    redirect('/dashboard?done=questionnaire');
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    reportError('calendar.questionnaire.redirect', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }
}
