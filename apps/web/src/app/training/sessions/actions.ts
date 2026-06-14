'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { trainingSessionCreateSchema } from '@/lib/schemas/training-session';
import { createTrainingSession, endTrainingSession } from '@/lib/training/training-session-service';

/**
 * Server Actions for the backtest-SESSION container (S8 Mode Entraînement —
 * "crée une session de backtest", brief §31 DoD#1). Carbon mirror of
 * `app/training/actions.ts`:
 *   - Re-call `auth()` at the top (defence in depth on top of `proxy.ts`).
 *   - Re-validate `FormData` with `trainingSessionCreateSchema` (the form's
 *     client checks are best-effort UX only).
 *   - Re-throw `NEXT_REDIRECT` so navigation isn't swallowed.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5, BLOCKING):
 *   - Audit metadata carries ids/flags ONLY — NEVER the member's free text
 *     (`label` / `notes`) nor any backtest P&L.
 *   - `revalidatePath` touches ONLY the `/training` surface — never `/journal`,
 *     `/dashboard` or any real edge.
 */

export interface CreateTrainingSessionActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
}

export interface EndTrainingSessionActionState {
  ok: boolean;
  error?: 'unauthorized' | 'not_found' | 'unknown';
}

function flattenFieldErrors(error: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
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

export async function createTrainingSessionAction(
  _prev: CreateTrainingSessionActionState | null,
  formData: FormData,
): Promise<CreateTrainingSessionActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    label: formData.get('label'),
    symbol: formData.get('symbol'),
    timeframe: formData.get('timeframe'),
    notes: formData.get('notes'),
  };

  const parsed = trainingSessionCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  const data = parsed.data;

  let sessionId: string;
  try {
    const created = await createTrainingSession({
      userId: session.user.id,
      label: data.label,
      symbol: data.symbol,
      timeframe: data.timeframe,
      notes: data.notes,
    });
    sessionId = created.id;
  } catch (err) {
    console.error('[training.createTrainingSession] failed', err);
    return { ok: false, error: 'unknown' };
  }

  // 🚨 §21.5 — PII-free: ids/flags only, never the label/notes free text.
  await logAudit({
    action: 'training_session.created',
    userId: session.user.id,
    metadata: {
      trainingSessionId: sessionId,
      hasSymbol: data.symbol !== null,
      hasTimeframe: data.timeframe !== null,
    },
  });

  // 🚨 §21.5 — training surface ONLY. Never /journal or /dashboard.
  revalidatePath('/training');

  // Land on the new session so the member can immediately add backtests to it.
  try {
    redirect(`/training/sessions/${sessionId}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[training.createTrainingSession] redirect failed', err);
  }
  return { ok: true };
}

/**
 * Mark a session as ended (bound action — the form binds `sessionId`). The
 * service scopes the update to `(id, memberId)`, so a member can only end their
 * own session; a stale id resolves to `not_found` (no throw).
 */
export async function endTrainingSessionAction(
  sessionId: string,
): Promise<EndTrainingSessionActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  let ended: boolean;
  try {
    ended = await endTrainingSession(sessionId, session.user.id, new Date());
  } catch (err) {
    console.error('[training.endTrainingSession] failed', err);
    return { ok: false, error: 'unknown' };
  }
  if (!ended) return { ok: false, error: 'not_found' };

  await logAudit({
    action: 'training_session.ended',
    userId: session.user.id,
    metadata: { trainingSessionId: sessionId },
  });

  revalidatePath('/training');
  revalidatePath(`/training/sessions/${sessionId}`);
  return { ok: true };
}
