'use server';

import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { cancelMeeting, markMeetingPresence, uncancelMeeting } from '@/lib/meeting/service';
import {
  meetingCancelSchema,
  meetingPresenceMarkSchema,
  presenceMarkToAdminPresent,
} from '@/lib/schemas/meeting';
import type { MeetingPresenceNotMarkableReason } from '@/lib/meeting/service';

/**
 * V1.7 §30 J-M3 — Server Action for the `/admin/reunions` admin surface.
 *
 * Pattern carbone V2.1 `admin/members/[id]/notes/actions.ts`:
 *   - re-`auth()` + status active + role === 'admin' (defense in depth on top
 *     of `proxy.ts` gating `/admin/*`);
 *   - Zod `safeParse` of the FormData (the server is the only authority);
 *   - discriminated `ActionState` for `useActionState`;
 *   - `revalidatePath('/admin/reunions')` (admin-only surface — never a member
 *     route).
 *
 * Posture §2 / PII-free audit (SPEC §30.7): the audit row carries
 * `{meetingId, cancelled}` ONLY — NEVER the `reason` free-text. The reason is
 * `safeFreeText`-sanitised inside `cancelMeeting` (bidi/zero-width stripping,
 * SPEC §30.6) before it ever touches the DB.
 */

export interface CancelMeetingActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'not_found' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** The resulting status on success (so the client can reflect it). */
  status?: 'scheduled' | 'cancelled';
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
 * Duck-type the service's `MeetingNotFoundError` WITHOUT importing the class
 * value — so the test can mock `@/lib/meeting/service` without re-exporting the
 * real class (the `instanceof` identity breaks under module mocking). Mirror of
 * the J-M2 `asNotDeclarableReason` helper.
 */
function isMeetingNotFound(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'MeetingNotFoundError'
  );
}

/**
 * Cancel ("pas dispo") or un-cancel a meeting slot. `useActionState`-friendly
 * (FormData carries `meetingId` + `action` + optional `reason`).
 */
export async function cancelMeetingAction(
  _prev: CancelMeetingActionState | null,
  formData: FormData,
): Promise<CancelMeetingActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const reason = getString(formData, 'reason');
  const parsed = meetingCancelSchema.safeParse({
    meetingId: getString(formData, 'meetingId'),
    action: getString(formData, 'action'),
    // Omit empty reason so the optional field stays undefined (not '').
    ...(reason.length > 0 ? { reason } : {}),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let status: 'scheduled' | 'cancelled';
  try {
    const result =
      parsed.data.action === 'cancel'
        ? await cancelMeeting(parsed.data.meetingId, parsed.data.reason)
        : await uncancelMeeting(parsed.data.meetingId);
    status = result.status;
  } catch (err) {
    if (isMeetingNotFound(err)) return { ok: false, error: 'not_found' };
    console.error('[admin.meeting.cancel] mutation failed', err);
    return { ok: false, error: 'unknown' };
  }

  // PII-FREE: meetingId + resulting state only. NEVER the reason text (§30.7).
  await logAudit({
    action: 'admin.meeting.cancelled',
    userId: session.user.id,
    metadata: { meetingId: parsed.data.meetingId, cancelled: status === 'cancelled' },
  });

  // Admin-only surface: refresh just the admin reunions list.
  revalidatePath('/admin/reunions');

  return { ok: true, status };
}

// S10 §30.8 — admin presence marking (recoupement admin↔membre) ---------------

export interface MarkPresenceActionState {
  ok: boolean;
  error?:
    | 'unauthorized'
    | 'forbidden'
    | 'invalid_input'
    | 'not_found'
    | 'cancelled'
    | 'member_not_found'
    | 'unknown';
  fieldErrors?: Record<string, string>;
  /** The resulting admin declaration on success (null = mark cleared). */
  adminPresent?: boolean | null;
}

/**
 * Duck-type the service's `MeetingPresenceNotMarkableError` WITHOUT importing
 * the class value (so tests can mock `@/lib/meeting/service`). Mirror of
 * `isMeetingNotFound` — returns the typed reason or null.
 */
function presenceNotMarkableReason(err: unknown): MeetingPresenceNotMarkableReason | null {
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'MeetingPresenceNotMarkableError' &&
    'reason' in err
  ) {
    return (err as { reason: MeetingPresenceNotMarkableReason }).reason;
  }
  return null;
}

/**
 * Mark (or clear) a member's presence for one meeting — the write side of the
 * recoupement admin↔membre. `useActionState`-friendly (FormData carries
 * `meetingId` + `memberId` + `present` ∈ present|absent|clear). Same auth +
 * Zod + PII-free audit shape as {@link cancelMeetingAction}.
 */
export async function markPresenceAction(
  _prev: MarkPresenceActionState | null,
  formData: FormData,
): Promise<MarkPresenceActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const parsed = meetingPresenceMarkSchema.safeParse({
    meetingId: getString(formData, 'meetingId'),
    memberId: getString(formData, 'memberId'),
    present: getString(formData, 'present'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  const adminPresent = presenceMarkToAdminPresent(parsed.data.present);
  try {
    await markMeetingPresence(
      session.user.id,
      parsed.data.meetingId,
      parsed.data.memberId,
      adminPresent,
    );
  } catch (err) {
    const reason = presenceNotMarkableReason(err);
    if (reason) return { ok: false, error: reason };
    console.error('[admin.meeting.presence] mutation failed', err);
    return { ok: false, error: 'unknown' };
  }

  // PII-FREE: meetingId + resulting tri-state only (posture §2, §30.7).
  await logAudit({
    action: 'admin.meeting.presence.marked',
    userId: session.user.id,
    metadata: { meetingId: parsed.data.meetingId, present: adminPresent },
  });

  // The mark moves: the admin per-member presence panel, the admin reunions
  // list gapCount, the per-meeting roster (F4), the cohort health view, AND the
  // member's own /reunions cross-check + honest rate. Revalidate the admin
  // surfaces (the member page is force-dynamic and re-reads on its next request).
  revalidatePath(`/admin/members/${parsed.data.memberId}`);
  revalidatePath('/admin/reunions');
  revalidatePath(`/admin/reunions/${parsed.data.meetingId}`);
  revalidatePath('/admin/health');

  return { ok: true, adminPresent };
}
