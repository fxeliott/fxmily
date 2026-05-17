'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { trainingTradeCreateSchema } from '@/lib/schemas/training-trade';
import { trainingKeyBelongsTo } from '@/lib/storage/local';
import { createTrainingTrade } from '@/lib/training/training-trade-service';

/**
 * Server Action for the Mode-Entraînement backtest journal (J-T2, SPEC §21).
 *
 * Carbon mirror of `app/journal/actions.ts` `createTradeAction`, adapted to
 * the lighter backtest field set:
 *   - Re-call `auth()` at the top (defence in depth on top of `proxy.ts`).
 *   - Re-validate `FormData` with `trainingTradeCreateSchema` (the wizard's
 *     client-side checks are best-effort UX only).
 *   - Bridge the optional `outcome`/`resultR` `undefined → null` HERE (not
 *     in the service — `| null` is the right service contract).
 *   - BOLA: the screenshot key's `userId` segment must be the session user.
 *   - Re-throw `NEXT_REDIRECT` so navigation isn't swallowed.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5, BLOCKING):
 *   - The audit metadata carries ONLY `{ trainingTradeId }` — NEVER the
 *     backtest P&L (`resultR`/`outcome`) nor `lessonLearned`. The J-T4
 *     engagement/inactivity wiring counts EFFORT, never a result.
 *   - We `revalidatePath('/training')` ONLY. The real edge (`/journal`,
 *     `/dashboard`, scoring) is never touched by a backtest write.
 */

export interface CreateTrainingTradeActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
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

export async function createTrainingTradeAction(
  _prev: CreateTrainingTradeActionState | null,
  formData: FormData,
): Promise<CreateTrainingTradeActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const rawOutcome = formData.get('outcome');
  const rawResultR = formData.get('resultR');
  const raw = {
    pair: formData.get('pair'),
    entryScreenshotKey: formData.get('entryScreenshotKey'),
    plannedRR: formData.get('plannedRR'),
    // Optional backtest result — empty/absent → null (mirrors the real
    // open/close split: a backtest may be logged before the result is set).
    outcome: rawOutcome === '' || rawOutcome == null ? null : rawOutcome,
    resultR: rawResultR === '' || rawResultR == null ? null : rawResultR,
    systemRespected: formData.get('systemRespected'),
    lessonLearned: formData.get('lessonLearned'),
    enteredAt: formData.get('enteredAt'),
  };

  const parsed = trainingTradeCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  // BOLA defence — the key shape was validated by Zod, but we must also
  // enforce that the `training/{userId}/…` segment belongs to the current
  // session, otherwise a member could attach another member's upload to
  // their own backtest. `trainingKeyBelongsTo` never cross-accepts a
  // real-edge `trades/` key (statistical isolation §21.5).
  if (!trainingKeyBelongsTo(data.entryScreenshotKey, session.user.id)) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { entryScreenshotKey: 'Capture invalide.' },
    };
  }

  let trainingTradeId: string;
  try {
    const trade = await createTrainingTrade({
      userId: session.user.id,
      pair: data.pair,
      entryScreenshotKey: data.entryScreenshotKey,
      plannedRR: data.plannedRR,
      outcome: data.outcome ?? null,
      resultR: data.resultR ?? null,
      systemRespected: data.systemRespected,
      lessonLearned: data.lessonLearned,
      enteredAt: data.enteredAt,
    });
    trainingTradeId = trade.id;
  } catch (err) {
    console.error('[training.createTrainingTrade] failed', err);
    return { ok: false, error: 'unknown' };
  }

  // 🚨 §21.5 — PII-free: ONLY the id. Never resultR/outcome/lessonLearned.
  await logAudit({
    action: 'training_trade.created',
    userId: session.user.id,
    metadata: { trainingTradeId },
  });

  // 🚨 §21.5 — training surface ONLY. Never /journal or /dashboard.
  revalidatePath('/training');

  try {
    redirect('/training');
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[training.createTrainingTrade] redirect failed', err);
  }
  return { ok: true };
}
