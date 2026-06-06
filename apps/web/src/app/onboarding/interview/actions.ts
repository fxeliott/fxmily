'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  appendAnswer,
  finalizeInterview,
  OnboardingInstrumentMismatchError,
  startInterview,
} from '@/lib/onboarding-interview/service';
import { reportError, reportWarning } from '@/lib/observability';
import {
  onboardingAnswerInputSchema,
  onboardingStartInputSchema,
} from '@/lib/schemas/onboarding-interview';

/**
 * V2.4 Phase B — Onboarding interview Server Actions (Session A, M3 directive
 * 2026-05-28).
 *
 * Three actions back the wizard at `/onboarding/interview/*` :
 *   - `startInterviewAction`   — create-or-reuse, redirect → `/onboarding/interview/new`.
 *   - `appendAnswerAction`     — per-question upsert, NO redirect (returns
 *                                crisisLevel + injectionSuspected so the
 *                                wizard can render banners inline).
 *   - `finalizeInterviewAction` — flip to completed + redirect → `/complete`.
 *
 * Pattern J5 V2.3 `submitPreTradeCheckAction` carbone strict :
 *   - Re-call `auth()` at the top (defence in depth on top of `proxy.ts`).
 *   - Gate `session.user.status === 'active'` (suspended/pending bounced).
 *   - Re-validate FormData with the strict Zod schema (client validation is
 *     best-effort UX, the Server Action is the only authority).
 *   - Return a discriminated `*ActionState` for `useActionState`.
 *   - Call `redirect()` directly: it ALWAYS throws `NEXT_REDIRECT`. No
 *     try/catch wrapper — if Next ever breaks the throw contract, letting
 *     the bug surface beats silently returning `{ ok: true }` and leaving
 *     the wizard hanging (J5 H2 fix carbone).
 *
 * Safety wiring (V1.8 REFLECT pattern) :
 *   - Crisis detection runs SYNCHRONOUSLY in the service layer
 *     (`service.ts:appendAnswer` calls `detectCrisis(answerText)`).
 *   - **Persist anyway** when crisis MEDIUM/HIGH detected (Q4=A — silent
 *     skip would loop the wizard ; differs from V1.7.1 batch.ts skip-persist
 *     which applies to AI OUTPUT, not member-written text).
 *   - Audit `onboarding.interview.crisis_detected` in a SEPARATE row paired
 *     with Sentry escalation (HIGH → reportError page-out, MEDIUM →
 *     reportWarning). LOW = noise, not escalated (mirror V1.7.1).
 *   - Same pattern for `injection_suspected` — security boundary, audit +
 *     Sentry warning, never blocks the wizard.
 *
 * Posture §27.7 instrument v1 immutable enforced :
 *   - `instrumentVersion` is `'v1'` (frozen catalog). Bumping v2+ requires
 *     a migration (see `instrument-v1.ts` longitudinal-validity invariant).
 *   - PII-FREE audit metadata strict §16. NEVER log `answerText` content
 *     nor `questionText` (the latter is derivable from instrument + index).
 */

// =============================================================================
// Action state discriminated unions (for `useActionState`)
// =============================================================================

export interface StartInterviewActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
}

export interface AppendAnswerActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** Highest crisis level detected in the answer, if any. UI surfaces banner. */
  crisisLevel?: 'high' | 'medium' | 'low';
  /** True iff prompt-injection patterns matched. UI surfaces calm warning. */
  injectionSuspected?: boolean;
}

export interface FinalizeInterviewActionState {
  ok: boolean;
  error?: 'unauthorized' | 'no_interview' | 'unknown';
}

// =============================================================================
// FormData helpers (carbone V2.3 pre-trade/actions.ts)
// =============================================================================

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
 * Coerce a FormData entry to an integer. Returns `NaN` if missing or
 * unparseable so the Zod schema's `z.number().int()` rejects loudly with a
 * field-level error — never silently coerce to 0 (which would map to
 * questionIndex 0 = first question and silently overwrite warmup answers).
 */
function getInt(formData: FormData, key: string): number {
  const v = formData.get(key);
  if (typeof v !== 'string') return Number.NaN;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

// =============================================================================
// startInterviewAction
// =============================================================================

/**
 * Create-or-reuse the onboarding interview for the authenticated member, then
 * redirect to the wizard host page `/onboarding/interview/new`.
 *
 * Idempotent : the service layer's `startInterview` returns the existing row
 * if one is already in flight (in_progress) or completed. The action audits
 * `onboarding.interview.started` on EVERY call (the audit captures the user
 * INTENT to (re)start, not the DB-side creation event — useful for funnel
 * analytics later).
 */
export async function startInterviewAction(
  _prev: StartInterviewActionState | null,
  formData: FormData,
): Promise<StartInterviewActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    instrumentVersion: getString(formData, 'instrumentVersion') || 'v1',
  };

  const parsed = onboardingStartInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let interview;
  try {
    interview = await startInterview(session.user.id, parsed.data);
  } catch (err) {
    reportError('onboarding.interview.start', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'onboarding.interview.started',
    userId: session.user.id,
    metadata: {
      interviewId: interview.id,
      instrumentVersion: interview.instrumentVersion,
    },
  });

  // Force-dynamic page reads `getInterviewForUser`, so a `revalidatePath` is a
  // no-op (V2.3.1 scar W1 carbone). Skip directly to redirect.
  redirect('/onboarding/interview/new');
}

/**
 * One-arg `(formData) => void` shape wrapper for use as a `<form action={...}>`
 * directly inside a Server Component (the landing CTA on `/onboarding/interview`).
 * Delegates to `startInterviewAction` ; redirects on success, throws on error.
 *
 * The discriminated `StartInterviewActionState` returned by the canonical
 * action is intentionally NOT surfaced to the membre on this path — the
 * landing form has no `useActionState` consumer, the redirect (success) or
 * a thrown error (failure) is the only UX outcome. The throw lets Next's
 * error boundary catch and surface a generic "something went wrong" page,
 * which is the correct degradation for an action that should be a no-op
 * idempotent createOrReuse on the happy path.
 */
export async function startInterviewFormAction(formData: FormData): Promise<void> {
  const state = await startInterviewAction(null, formData);
  // `startInterviewAction` throws NEXT_REDIRECT on success ; reaching here
  // means we got a discriminated error state back.
  if (state.error === 'unauthorized') {
    redirect('/login');
  }
  // Any other error (`invalid_input`, `unknown`) → throw so Next's error
  // boundary surfaces a generic page. The landing form has no field-error
  // UI affordance.
  throw new Error(`startInterviewAction failed: ${state.error ?? 'unknown'}`);
}

// =============================================================================
// appendAnswerAction
// =============================================================================

/**
 * Append (or upsert) one answer to the in-flight interview. Returns crisis +
 * injection signals so the wizard can render banners inline ; never redirects
 * (the wizard advances client-side after a successful append).
 *
 * Q4=A persist-anyway invariant (carbone V1.8 REFLECT) :
 *   - Crisis MEDIUM/HIGH detected → persist anyway, audit the safety signal
 *     in a SEPARATE row, escalate Sentry. Silent skip would break the wizard
 *     UX (membre re-types, re-trip, infinite loop).
 *   - Injection suspected → persist anyway, audit, Sentry warning. The
 *     content goes to a future Claude analysis (Phase A.2 batch), where
 *     `wrapUntrustedMemberInput` will XML-wrap it as defense-in-depth.
 */
export async function appendAnswerAction(
  _prev: AppendAnswerActionState | null,
  formData: FormData,
): Promise<AppendAnswerActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    instrumentVersion: getString(formData, 'instrumentVersion') || 'v1',
    questionIndex: getInt(formData, 'questionIndex'),
    questionKey: getString(formData, 'questionKey'),
    answerText: getString(formData, 'answerText'),
  };

  const parsed = onboardingAnswerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let result;
  try {
    result = await appendAnswer(session.user.id, parsed.data);
  } catch (err) {
    if (err instanceof OnboardingInstrumentMismatchError) {
      // Catalog mismatch = forged/buggy client. A legit wizard always submits a
      // valid (index, key) from the same instrument, so this never fires on the
      // happy path. Surface as a field error (not a 500) + reportWarning for
      // forensics — NOT reportError (it is not a server fault).
      reportWarning('onboarding.interview.append', 'instrument_mismatch_rejected', {
        questionIndex: parsed.data.questionIndex,
      });
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { questionIndex: err.message },
      };
    }
    reportError('onboarding.interview.append', err);
    return { ok: false, error: 'unknown' };
  }

  // Primary audit row : captures the full picture in one place (interviewId,
  // questionIndex, questionKey, crisisDetected, injectionSuspected).
  await logAudit({
    action: 'onboarding.interview.answer_submitted',
    userId: session.user.id,
    metadata: {
      interviewId: result.interview.id,
      questionIndex: parsed.data.questionIndex,
      questionKey: parsed.data.questionKey,
      crisisDetected: result.crisisDetected,
      injectionSuspected: result.injectionDetected,
    },
  });

  // Safety escalation rows + Sentry — paired with the primary row above. The
  // service layer ran `detectCrisis(answerText)` already and surfaced flags ;
  // we re-run here ONLY to obtain the canonical `level` + `matchedLabels` for
  // audit metadata (the service's `AppendAnswerResult` exposes booleans only).
  let crisisLevel: 'high' | 'medium' | 'low' | undefined;
  if (result.crisisDetected) {
    const { detectCrisis } = await import('@/lib/safety/crisis-detection');
    const detection = detectCrisis(parsed.data.answerText);
    if (detection.level === 'high' || detection.level === 'medium') {
      crisisLevel = detection.level;
      await logAudit({
        action: 'onboarding.interview.crisis_detected',
        userId: session.user.id,
        metadata: {
          interviewId: result.interview.id,
          questionIndex: parsed.data.questionIndex,
          level: detection.level,
          matchedLabels: detection.matches.map((m) => m.label),
        },
      });
      if (detection.level === 'high') {
        reportError(
          'onboarding.interview.crisis_high',
          new Error('Crisis HIGH signal detected in onboarding interview answer'),
          {
            interviewId: result.interview.id,
            questionIndex: parsed.data.questionIndex,
            matchedLabels: detection.matches.map((m) => m.label),
          },
        );
      } else {
        reportWarning(
          'onboarding.interview.crisis_medium',
          'crisis_medium_signal_detected_in_onboarding_answer',
          {
            interviewId: result.interview.id,
            questionIndex: parsed.data.questionIndex,
            matchedLabels: detection.matches.map((m) => m.label),
          },
        );
      }
    } else if (detection.level === 'low') {
      // LOW = noise, not escalated (mirror V1.7.1). Track it as a soft
      // hint so the client can still surface a calm hint if it wants.
      crisisLevel = 'low';
    }
  }

  let injectionSuspected = false;
  if (result.injectionDetected) {
    const { detectInjection } = await import('@/lib/ai/injection-detector');
    const detection = detectInjection(parsed.data.answerText);
    if (detection.suspected) {
      injectionSuspected = true;
      await logAudit({
        action: 'onboarding.interview.injection_suspected',
        userId: session.user.id,
        metadata: {
          interviewId: result.interview.id,
          questionIndex: parsed.data.questionIndex,
          matchedLabels: detection.matchedLabels,
        },
      });
      reportWarning(
        'onboarding.interview.injection',
        'prompt_injection_suspected_in_onboarding_answer',
        {
          interviewId: result.interview.id,
          questionIndex: parsed.data.questionIndex,
          matchedLabels: detection.matchedLabels,
        },
      );
    }
  }

  // No redirect — wizard advances client-side. Revalidate the dynamic host
  // page is a no-op (`/new/page.tsx` will be force-dynamic), so we skip it.

  const out: AppendAnswerActionState = { ok: true };
  if (crisisLevel) out.crisisLevel = crisisLevel;
  if (injectionSuspected) out.injectionSuspected = true;
  return out;
}

// =============================================================================
// finalizeInterviewAction
// =============================================================================

/**
 * Flip the interview status `started`/`in_progress` → `completed` and redirect
 * to the calm-reveal page `/onboarding/interview/complete`. Idempotent : the
 * service layer returns the existing row unchanged when already-completed
 * (returns `null` if no interview exists at all).
 *
 * Phase A.2 batch local Claude pipeline (already LIVE prod, V2.4 PR #190)
 * sweeps `WHERE status='completed' AND analyzedAt IS NULL` rows on the next
 * batch run. The `/profile` page will surface the resulting `MemberProfile`.
 */
export async function finalizeInterviewAction(
  _prev: FinalizeInterviewActionState | null,
  _formData: FormData,
): Promise<FinalizeInterviewActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  let interview;
  try {
    interview = await finalizeInterview(session.user.id);
  } catch (err) {
    reportError('onboarding.interview.finalize', err);
    return { ok: false, error: 'unknown' };
  }

  if (interview === null) {
    // Defensive : a wizard reach-finalize without a started interview is a
    // client bug ; the action returns an error so the wizard can recover
    // (re-call startInterview or bounce to landing).
    return { ok: false, error: 'no_interview' };
  }

  await logAudit({
    action: 'onboarding.interview.completed',
    userId: session.user.id,
    metadata: {
      interviewId: interview.id,
      completedAt: interview.completedAt,
    },
  });

  // Invalidate `/profile` cache so the post-batch MemberProfile (whenever it
  // lands) becomes visible. `/dashboard` doesn't surface profile data V1 but
  // a future widget might (V2 polish, deferred).
  revalidatePath('/profile');

  redirect('/onboarding/interview/complete');
}
