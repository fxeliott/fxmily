'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { localWallClockToUtc } from '@/lib/checkin/timezone';
import { sendTrainingReplyReceivedEmail } from '@/lib/email/send';
import { enqueueTrainingReplyNotification } from '@/lib/notifications/enqueue';
import { trainingReplyCreateSchema } from '@/lib/schemas/training-annotation';
import { trainingSessionIdSchema } from '@/lib/schemas/training-session';
import { trainingTradeCreateSchema } from '@/lib/schemas/training-trade';
import { replyToTrainingAnnotationAsMember } from '@/lib/training/training-annotation-member-service';
import { getTrainingSessionMeta } from '@/lib/training/training-session-service';
import { createTrainingTrade } from '@/lib/training/training-trade-service';

/** Read a tri-state checklist field from FormData. The wizard sends
 * `'true'` / `'false'` / `'na'`; an absent field (member skipped the item)
 * must become `undefined` so the `.optional()` checklist schema short-circuits
 * — `formData.get` returns `null` for an absent field, which the tri-state
 * union would reject. */
function readChecklistField(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' ? v : undefined;
}

/**
 * F2 — interpret a `datetime-local` wall-clock string submitted by the member
 * as a moment in THEIR set timezone, converted to a UTC instant server-side
 * (deterministic; the device timezone no longer leaks into stored backtest
 * times). EXACT mirror of `journal/actions.ts` `memberWallClock`. Non-string or
 * unparseable values fall through unchanged so the Zod `z.coerce.date()` still
 * surfaces "Date invalide." on garbage and accepts already-absolute Dates.
 */
function memberWallClock(value: FormDataEntryValue | null, timezone: string): unknown {
  if (typeof value !== 'string') return value;
  return localWallClockToUtc(value, timezone) ?? value;
}

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

  // F2 — the member's set timezone is authoritative for the entry wall-clock
  // (mirror of journal/actions.ts createTradeAction).
  const timezone = session.user.timezone || 'Europe/Paris';
  const rawOutcome = formData.get('outcome');
  const rawResultR = formData.get('resultR');
  const rawTradingViewUrl = formData.get('tradingViewUrl');
  // Optional backtest result — empty/absent → null (mirrors the real
  // open/close split: a backtest may be logged before the result is set).
  const outcome = rawOutcome === '' || rawOutcome == null ? null : rawOutcome;
  const raw = {
    pair: formData.get('pair'),
    // Tour 13 — the legacy `entryScreenshotKey` input is gone: no wizard sends
    // an image key since J1, and image capture now lives only in the
    // verification flow. The create schema no longer reads it; the DB column +
    // display of pre-J1 training captures are untouched (§21.5 preserved).
    // J1 — MANDATORY TradingView link (replaces the former screenshot upload).
    // Coerce absent → '' so the required schema's `.min(1)` surfaces the clean
    // "obligatoire" message rather than a generic "expected string".
    tradingViewUrl: rawTradingViewUrl ?? '',
    // Tour 13 — optional member explanation of the analysis screen. Absent → the
    // optional Zod string short-circuits (FormData.get returns null when absent).
    tradingViewNote: formData.get('tradingViewNote') ?? undefined,
    plannedRR: formData.get('plannedRR'),
    outcome,
    // P3 — defensive coherence guard: an analysis-only backtest (no outcome)
    // can never carry a result in R. Silent cleanup, never a rejection: a
    // stale wizard draft or a crafted request must not produce a card showing
    // both « EN ATTENTE » and a « RÉSULTAT x R » (mirror of the wizard's
    // clearing when « Aucun » is selected).
    resultR: outcome === null || rawResultR === '' || rawResultR == null ? null : rawResultR,
    systemRespected: formData.get('systemRespected'),
    // S8 V2 — process-discipline checklist (§33-2). Tri-state + optional: an
    // untouched item is `undefined`, normalised to `null` at the service layer.
    planFollowed: readChecklistField(formData, 'planFollowed'),
    riskDefinedBefore: readChecklistField(formData, 'riskDefinedBefore'),
    emotionalStateNoted: readChecklistField(formData, 'emotionalStateNoted'),
    noImpulsiveDeviation: readChecklistField(formData, 'noImpulsiveDeviation'),
    lessonLearned: formData.get('lessonLearned'),
    enteredAt: memberWallClock(formData.get('enteredAt'), timezone),
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

  // Tour 13 — no training image key is accepted anymore, so the former
  // `entryScreenshotKey` BOLA `trainingKeyBelongsTo` check is gone. Only the
  // verification flow uploads images. Existing captures still display (§21.5
  // isolation unchanged).

  // S8 — optional parent backtest session. Validate the id shape, then enforce
  // OWNERSHIP **and** open-state: a member must never attach a backtest to
  // another member's session (§21.5 + BOLA), nor to an ENDED session (mirror
  // of `/training/new` which drops an ended/foreign id — the UI hides the CTA,
  // so a hit here is a stale tab or a crafted request). A stale/forged/ended id
  // resolves to invalid_input, never a silent cross-member or ended-container
  // write. `getTrainingSessionMeta` is the same owner-scoped single-query read
  // (`findFirst { id, memberId }`) the page uses, so BOLA is identical.
  const sessionIdParsed = trainingSessionIdSchema.safeParse(formData.get('sessionId'));
  if (!sessionIdParsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: { sessionId: 'Session invalide.' } };
  }
  const sessionId = sessionIdParsed.data;
  if (sessionId !== null) {
    const parentMeta = await getTrainingSessionMeta(sessionId, session.user.id);
    if (!parentMeta || parentMeta.isEnded) {
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { sessionId: 'Session introuvable ou terminée.' },
      };
    }
  }

  let trainingTradeId: string;
  try {
    const trade = await createTrainingTrade({
      userId: session.user.id,
      pair: data.pair,
      tradingViewUrl: data.tradingViewUrl,
      tradingViewNote: data.tradingViewNote ?? null,
      plannedRR: data.plannedRR,
      outcome: data.outcome ?? null,
      resultR: data.resultR ?? null,
      systemRespected: data.systemRespected,
      planFollowed: data.planFollowed,
      riskDefinedBefore: data.riskDefinedBefore,
      emotionalStateNoted: data.emotionalStateNoted,
      noImpulsiveDeviation: data.noImpulsiveDeviation,
      lessonLearned: data.lessonLearned,
      enteredAt: data.enteredAt,
      sessionId,
    });
    trainingTradeId = trade.id;
  } catch (err) {
    console.error('[training.createTrainingTrade] failed', err);
    return { ok: false, error: 'unknown' };
  }

  // 🚨 §21.5 — PII-free: ids/flags ONLY. Never resultR/outcome/lessonLearned.
  await logAudit({
    action: 'training_trade.created',
    userId: session.user.id,
    metadata: { trainingTradeId, inSession: sessionId !== null },
  });

  // 🚨 §21.5 — training surface ONLY. Never /journal or /dashboard.
  revalidatePath('/training');
  if (sessionId !== null) revalidatePath(`/training/sessions/${sessionId}`);

  try {
    // Logged inside a session → return to that session (the member keeps
    // adding backtests to the same sitting); otherwise the standalone list.
    redirect(sessionId !== null ? `/training/sessions/${sessionId}` : '/training');
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[training.createTrainingTrade] redirect failed', err);
  }
  return { ok: true };
}

// =============================================================================
// S8 V2 §32-4 — member reply to a backtest correction
// =============================================================================

export interface ReplyTrainingAnnotationActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_found' | 'unknown';
  fieldErrors?: Record<string, string>;
  message?: string;
}

/**
 * Record the member's reply to one of Eliott's backtest corrections (§32-4 :
 * « le membre les voit et peut y répondre »). Carbon mirror of
 * `createTrainingTradeAction`'s posture:
 *   - Re-call `auth()` (defence in depth over `proxy.ts`).
 *   - Re-parse `trainingReplyCreateSchema` (the client checks are UX only).
 *   - Ownership is enforced in the service (`replyToTrainingAnnotationAsMember`
 *     scopes through `TrainingTrade.userId`) — a foreign/typo id → `not_found`.
 *   - Notify the authoring admin ONCE (first reply only; a later edit must not
 *     re-ping). Best-effort — a queue hiccup never rolls back the reply.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5, BLOCKING):
 *   - Audit + notification metadata carry ids ONLY — NEVER the reply text nor
 *     any backtest P&L.
 *   - `revalidatePath` touches ONLY the member `/training/<id>` surface and the
 *     admin training detail — NEVER `/journal`, `/dashboard` or any real edge.
 */
export async function replyToTrainingAnnotationAction(
  _prev: ReplyTrainingAnnotationActionState | null,
  formData: FormData,
): Promise<ReplyTrainingAnnotationActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const parsed = trainingReplyCreateSchema.safeParse({
    trainingAnnotationId: formData.get('trainingAnnotationId'),
    reply: formData.get('reply'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  let result: Awaited<ReturnType<typeof replyToTrainingAnnotationAsMember>>;
  try {
    result = await replyToTrainingAnnotationAsMember(
      session.user.id,
      parsed.data.trainingAnnotationId,
      parsed.data.reply,
    );
  } catch (err) {
    console.error('[training.replyToTrainingAnnotation] failed', err);
    return { ok: false, error: 'unknown' };
  }
  if (!result) {
    return { ok: false, error: 'not_found' };
  }

  // 🚨 §21.5 — PII-free: ids + a flag ONLY. Never the reply text or P&L.
  await logAudit({
    action: 'training_annotation.replied',
    userId: session.user.id,
    metadata: {
      trainingAnnotationId: parsed.data.trainingAnnotationId,
      trainingTradeId: result.trainingTradeId,
      isFirstReply: result.isFirstReply,
    },
  });

  // Notify the authoring admin ONCE (first reply). Best-effort, never thrown.
  if (result.isFirstReply) {
    await enqueueTrainingReplyNotification(result.adminId, {
      trainingAnnotationId: parsed.data.trainingAnnotationId,
      trainingTradeId: result.trainingTradeId,
      memberId: result.memberId,
    });

    // Parity with the admin→member correction flow: an IMMEDIATE best-effort
    // email so a push-less admin is still notified (the J9 dispatcher returns on
    // `no_subscriptions` before its fallback). §21.5/RGPD: admin training
    // deep-link only, no member PII in the body. Never rolls back the reply.
    void sendTrainingReplyReceivedEmail({
      to: result.adminEmail,
      recipientFirstName: result.adminFirstName,
      memberId: result.memberId,
      trainingTradeId: result.trainingTradeId,
    }).catch((err) => {
      console.error('[training.replyToTrainingAnnotation] email failed', err);
    });
  }

  // 🚨 §21.5 — training surfaces ONLY. Member detail + admin detail; never the
  // real edge. The member stays on the page (no redirect) so the reply renders
  // inline beneath the correction.
  revalidatePath(`/training/${result.trainingTradeId}`);
  revalidatePath(`/admin/members/${result.memberId}/training/${result.trainingTradeId}`);

  return { ok: true, message: 'Réponse envoyée.' };
}
