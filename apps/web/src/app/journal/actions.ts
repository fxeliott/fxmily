'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { tradeCloseSchema, tradeOpenSchema } from '@/lib/schemas/trade';
import { scheduleScoreRecompute } from '@/lib/scoring/scheduler';
import { keyBelongsTo } from '@/lib/storage/local';
import {
  TradeAlreadyClosedError,
  TradeNotFoundError,
  closeTrade,
  createTrade,
  deleteTrade,
} from '@/lib/trades/service';

/**
 * Server Actions for the trading journal (J2, SPEC §7.3).
 *
 * Pattern recap (matches J1 conventions):
 *   - Always re-call `auth()` at the top — defence in depth on top of the
 *     `proxy.ts` gating.
 *   - Re-validate `FormData` with the Zod schemas (the wizard's client-side
 *     `methods.trigger()` is best-effort UX).
 *   - Return a discriminated `ActionState` for `useActionState`.
 *   - Re-throw `NEXT_REDIRECT` errors so navigation isn't swallowed.
 */

export interface CreateTradeActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** On success the action redirects, this only fires for the no-close path. */
  tradeId?: string;
}

export interface CloseTradeActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_found' | 'already_closed' | 'unknown';
  fieldErrors?: Record<string, string>;
}

export interface DeleteTradeActionState {
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

/**
 * Create a new trade (open state). The wizard submits this when the user
 * fills the pre-entry block and either:
 *   - chose "save without close" → we redirect to `/journal/[id]` showing
 *     the open trade with a "close it now" CTA;
 *   - chose to continue to the post-exit step → the wizard captures the
 *     returned `tradeId` and immediately follows up with `closeTradeAction`.
 *
 * The split create-then-close flow is what lets us persist screenshots even
 * if the user backs out before submitting the post-exit block.
 */
export async function createTradeAction(
  _prev: CreateTradeActionState | null,
  formData: FormData,
): Promise<CreateTradeActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    pair: formData.get('pair'),
    direction: formData.get('direction'),
    session: formData.get('session'),
    enteredAt: formData.get('enteredAt'),
    entryPrice: formData.get('entryPrice'),
    lotSize: formData.get('lotSize'),
    stopLossPrice:
      formData.get('stopLossPrice') === '' || formData.get('stopLossPrice') == null
        ? null
        : formData.get('stopLossPrice'),
    plannedRR: formData.get('plannedRR'),
    emotionBefore: formData
      .getAll('emotionBefore')
      .filter((v): v is string => typeof v === 'string'),
    planRespected: formData.get('planRespected'),
    hedgeRespected: formData.get('hedgeRespected'),
    notes: formData.get('notes') ?? undefined,
    screenshotEntryKey: formData.get('screenshotEntryKey'),
  };

  const parsed = tradeOpenSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const continueToClose = formData.get('continueToClose') === 'true';

  // BOLA defence: the key shape was already validated by Zod, but we must
  // also enforce that the userId segment belongs to the *current session* —
  // otherwise an authenticated attacker could attach another member's
  // (or admin-uploaded) screenshot to their own trade.
  if (!keyBelongsTo(data.screenshotEntryKey, session.user.id)) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { screenshotEntryKey: 'Capture invalide.' },
    };
  }

  let tradeId: string;
  try {
    const trade = await createTrade(session.user.id, {
      pair: data.pair,
      direction: data.direction,
      session: data.session,
      enteredAt: data.enteredAt,
      entryPrice: data.entryPrice,
      lotSize: data.lotSize,
      stopLossPrice: data.stopLossPrice ?? null,
      plannedRR: data.plannedRR,
      emotionBefore: data.emotionBefore,
      planRespected: data.planRespected,
      hedgeRespected: data.hedgeRespected,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
      screenshotEntryKey: data.screenshotEntryKey,
    });
    tradeId = trade.id;
  } catch (err) {
    console.error('[journal.createTrade] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'trade.created',
    userId: session.user.id,
    metadata: { tradeId, pair: data.pair, direction: data.direction },
  });

  revalidatePath('/journal');
  revalidatePath('/dashboard');
  scheduleScoreRecompute(session.user.id, 'trade.created', session.user.timezone || 'Europe/Paris');

  // Navigate. We never reach the function's normal return on the success path.
  try {
    if (continueToClose) {
      redirect(`/journal/${tradeId}/close`);
    } else {
      redirect(`/journal/${tradeId}`);
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[journal.createTrade] redirect failed', err);
  }
  return { ok: true, tradeId };
}

export async function closeTradeAction(
  tradeId: string,
  _prev: CloseTradeActionState | null,
  formData: FormData,
): Promise<CloseTradeActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    exitedAt: formData.get('exitedAt'),
    exitPrice: formData.get('exitPrice'),
    outcome: formData.get('outcome'),
    emotionAfter: formData.getAll('emotionAfter').filter((v): v is string => typeof v === 'string'),
    notes: formData.get('notes') ?? undefined,
    screenshotExitKey: formData.get('screenshotExitKey'),
  };

  const parsed = tradeCloseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  // BOLA defence — same rationale as createTradeAction.
  if (!keyBelongsTo(data.screenshotExitKey, session.user.id)) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { screenshotExitKey: 'Capture invalide.' },
    };
  }

  try {
    await closeTrade(session.user.id, tradeId, {
      exitedAt: data.exitedAt,
      exitPrice: data.exitPrice,
      outcome: data.outcome,
      emotionAfter: data.emotionAfter,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
      screenshotExitKey: data.screenshotExitKey,
    });
  } catch (err) {
    if (err instanceof TradeNotFoundError) return { ok: false, error: 'not_found' };
    if (err instanceof TradeAlreadyClosedError) return { ok: false, error: 'already_closed' };
    console.error('[journal.closeTrade] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'trade.closed',
    userId: session.user.id,
    metadata: { tradeId, outcome: data.outcome },
  });

  revalidatePath('/journal');
  revalidatePath(`/journal/${tradeId}`);
  revalidatePath('/dashboard');
  scheduleScoreRecompute(session.user.id, 'trade.closed', session.user.timezone || 'Europe/Paris');

  try {
    redirect(`/journal/${tradeId}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[journal.closeTrade] redirect failed', err);
  }
  return { ok: true };
}

export async function deleteTradeAction(tradeId: string): Promise<DeleteTradeActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  try {
    await deleteTrade(session.user.id, tradeId);
  } catch (err) {
    if (err instanceof TradeNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[journal.deleteTrade] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'trade.deleted',
    userId: session.user.id,
    metadata: { tradeId },
  });

  revalidatePath('/journal');
  revalidatePath('/dashboard');
  scheduleScoreRecompute(session.user.id, 'trade.deleted', session.user.timezone || 'Europe/Paris');

  try {
    redirect('/journal');
  } catch (err) {
    if (isNextRedirect(err)) throw err;
  }
  return { ok: true };
}
