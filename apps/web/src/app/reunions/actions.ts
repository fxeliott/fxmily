'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { declareMeetingAbsence, declareMeetingAttendance } from '@/lib/meeting/service';
import type { MeetingNotDeclarableReason } from '@/lib/meeting/service';
import { reportWarning } from '@/lib/observability';
import {
  meetingAbsenceDeclarationSchema,
  meetingAttendanceDeclarationSchema,
} from '@/lib/schemas/meeting';

/**
 * V1.7 §30 J-M2 — Server Action for the `/reunions` member surface.
 *
 * Pattern J5 `submitMorningCheckinAction` / V2.3 `submitPreTradeCheckAction`
 * carbone:
 *   - Re-call `auth()` + `status === 'active'` at the top (defence in depth on
 *     top of `proxy.ts`).
 *   - Re-validate FormData with the strict Zod schema (client-side gating is
 *     best-effort UX; the Server Action is the only authority).
 *   - Service applies the HARD declarability guard (cancelled / future /
 *     out-of-window, SPEC §30.7) → mapped to a neutral `not_declarable` state.
 *   - `redirect()` directly: it ALWAYS throws `NEXT_REDIRECT`. No try/catch
 *     wrapper (J5 H2 fix — letting a broken throw contract surface beats
 *     silently returning `{ ok: true }`).
 *
 * Posture §2: PII-FREE audit metadata (the meeting id + the two closed-
 * instrument fields, NEVER the Ichor content — `contentReviewed` is a boolean).
 */

export interface DeclareMeetingAttendanceActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_declarable' | 'unknown';
  fieldErrors?: Record<string, string>;
  notDeclarableReason?: MeetingNotDeclarableReason;
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
 * Coerce a FormData entry to a boolean. Recognised truthy forms (case-insens.):
 * `'on'` (HTML checkbox checked), `'true'`, `'1'`, `'yes'`. Anything else
 * (`'off'`, `'false'`, `'0'`, `'no'`, missing, non-string) → `false`.
 *
 * Defense against the `Boolean('false') === true` JS footgun.
 */
function coerceBool(formData: FormData, key: string): boolean {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

/**
 * Duck-type the service's `MeetingNotDeclarableError` WITHOUT importing the
 * class value — so the Server Action test can mock `@/lib/meeting/service`
 * without re-exporting the real class (the `instanceof` identity would break
 * under module mocking). Type-only import of `MeetingNotDeclarableReason` is
 * erased at runtime and unaffected by the mock.
 */
function asNotDeclarableReason(err: unknown): MeetingNotDeclarableReason | null {
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'MeetingNotDeclarableError' &&
    'reason' in err &&
    typeof (err as { reason: unknown }).reason === 'string'
  ) {
    return (err as { reason: MeetingNotDeclarableReason }).reason;
  }
  return null;
}

export async function declareMeetingAttendanceAction(
  _prev: DeclareMeetingAttendanceActionState | null,
  formData: FormData,
): Promise<DeclareMeetingAttendanceActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    meetingId: getString(formData, 'meetingId'),
    attendanceMode: getString(formData, 'attendanceMode'),
    contentReviewed: coerceBool(formData, 'contentReviewed'),
  };

  const parsed = meetingAttendanceDeclarationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  try {
    await declareMeetingAttendance(session.user.id, parsed.data);
  } catch (err) {
    const reason = asNotDeclarableReason(err);
    if (reason) {
      return { ok: false, error: 'not_declarable', notDeclarableReason: reason };
    }
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportWarning('reunions.declare', 'persist_failed', { code });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'meeting.attendance.declared',
    userId: session.user.id,
    metadata: {
      meetingId: parsed.data.meetingId,
      attendanceMode: parsed.data.attendanceMode,
      contentReviewed: parsed.data.contentReviewed,
    },
  });

  revalidatePath('/reunions');

  // J5 H2 fix: `redirect()` always throws (NEXT_REDIRECT). No try/catch.
  redirect('/reunions');
}

/**
 * F4 — Server Action for the member's EXPLICIT "je n'ai pas pu y assister".
 * Same shape/guards as {@link declareMeetingAttendanceAction} but a single-field
 * payload (only `meetingId`). Reuses {@link DeclareMeetingAttendanceActionState}
 * (identical error surface). PII-free audit (`meetingId` only, posture §2).
 */
export async function declareMeetingAbsenceAction(
  _prev: DeclareMeetingAttendanceActionState | null,
  formData: FormData,
): Promise<DeclareMeetingAttendanceActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const parsed = meetingAbsenceDeclarationSchema.safeParse({
    meetingId: getString(formData, 'meetingId'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  try {
    await declareMeetingAbsence(session.user.id, parsed.data);
  } catch (err) {
    const reason = asNotDeclarableReason(err);
    if (reason) {
      return { ok: false, error: 'not_declarable', notDeclarableReason: reason };
    }
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportWarning('reunions.absence', 'persist_failed', { code });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'meeting.attendance.absent',
    userId: session.user.id,
    metadata: { meetingId: parsed.data.meetingId },
  });

  revalidatePath('/reunions');
  redirect('/reunions');
}
