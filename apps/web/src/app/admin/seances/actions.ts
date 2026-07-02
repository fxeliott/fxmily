'use server';

import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  declareSeanceGoNoGo,
  requestSeanceRegeneration,
  type SeanceGoNoGoError,
  type SeanceRegenerateError,
} from '@/lib/seances/admin-service';
import { seanceGoNoGoSchema, seanceRegenerateSchema } from '@/lib/schemas/seance';

/**
 * Réunion hub (séances) — admin go/no-go Server Actions (J3).
 *
 * Pattern carbone `app/admin/reunions/actions.ts`:
 *   - re-`auth()` + status active + role === 'admin' (defence in depth on top of
 *     `proxy.ts` gating `/admin/*`),
 *   - Zod `safeParse` of the FormData (the server is the only authority),
 *   - discriminated `ActionState` for `useActionState`,
 *   - `revalidatePath('/admin/seances')` (admin-only surface).
 *
 * Posture §2 / PII-free audit: the audit row carries `{date, slot, status}` ONLY
 * — NEVER the cancel `reason` free-text (`safeFreeText`-sanitised inside the
 * service before it ever reaches the DB).
 */

export interface SeanceGoNoGoActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'backfill' | 'no_rewind' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** The resulting status on success (so the client can reflect it). */
  status?: 'scheduled' | 'done' | 'cancelled';
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
 * Duck-type the service's `SeanceGoNoGoError` WITHOUT importing the class value
 * — so the test can mock `@/lib/seances/admin-service` without the `instanceof`
 * identity breaking under module mocking (mirror `isMeetingNotFound`). Returns
 * the typed reason or null.
 */
function goNoGoRejectReason(err: unknown): SeanceGoNoGoError['reason'] | null {
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'SeanceGoNoGoError' &&
    'reason' in err
  ) {
    return (err as { reason: SeanceGoNoGoError['reason'] }).reason;
  }
  return null;
}

/**
 * Declare go/no-go for one `(date, slot)`. `useActionState`-friendly (FormData
 * carries `date` + `slot` + `status` + optional `time` + optional `reason`).
 */
export async function declareSeanceGoNoGoAction(
  _prev: SeanceGoNoGoActionState | null,
  formData: FormData,
): Promise<SeanceGoNoGoActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const time = getString(formData, 'time');
  const reason = getString(formData, 'reason');
  const parsed = seanceGoNoGoSchema.safeParse({
    date: getString(formData, 'date'),
    slot: getString(formData, 'slot'),
    status: getString(formData, 'status'),
    // Omit empty optionals so they stay undefined (not '').
    ...(time.length > 0 ? { time } : {}),
    ...(reason.length > 0 ? { reason } : {}),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  try {
    await declareSeanceGoNoGo({
      date: parsed.data.date,
      slot: parsed.data.slot,
      status: parsed.data.status,
      // exactOptionalPropertyTypes: omit undefined optionals (never pass them).
      ...(parsed.data.time !== undefined ? { time: parsed.data.time } : {}),
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    });
  } catch (err) {
    const reasonCode = goNoGoRejectReason(err);
    if (reasonCode) return { ok: false, error: reasonCode };
    // `parseLocalDate` throws on a non-calendar date → treat as invalid input.
    if (err instanceof Error && /Invalid (local date|calendar date)/.test(err.message)) {
      return { ok: false, error: 'invalid_input' };
    }
    console.error('[admin.seance.gonogo] mutation failed', err);
    return { ok: false, error: 'unknown' };
  }

  // PII-FREE: slot coordinates + resulting status only. NEVER the reason text.
  await logAudit({
    action: 'admin.seance.declared',
    userId: session.user.id,
    metadata: { date: parsed.data.date, slot: parsed.data.slot, status: parsed.data.status },
  });

  revalidatePath('/admin/seances');
  return { ok: true, status: parsed.data.status };
}

export interface SeanceRegenerateActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'not_found' | 'not_done' | 'unknown';
  fieldErrors?: Record<string, string>;
}

function regenerateRejectReason(err: unknown): SeanceRegenerateError['reason'] | null {
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'SeanceRegenerateError' &&
    'reason' in err
  ) {
    return (err as { reason: SeanceRegenerateError['reason'] }).reason;
  }
  return null;
}

/**
 * Re-arm the AI step on a held session (the J4 pipeline regenerates its content
 * on its next pass). `useActionState`-friendly (FormData carries `date` + `slot`).
 */
export async function regenerateSeanceAction(
  _prev: SeanceRegenerateActionState | null,
  formData: FormData,
): Promise<SeanceRegenerateActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const parsed = seanceRegenerateSchema.safeParse({
    date: getString(formData, 'date'),
    slot: getString(formData, 'slot'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  try {
    await requestSeanceRegeneration(parsed.data.date, parsed.data.slot);
  } catch (err) {
    const reasonCode = regenerateRejectReason(err);
    if (reasonCode) return { ok: false, error: reasonCode };
    console.error('[admin.seance.regenerate] mutation failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'admin.seance.regenerate',
    userId: session.user.id,
    metadata: { date: parsed.data.date, slot: parsed.data.slot },
  });

  revalidatePath('/admin/seances');
  return { ok: true };
}
