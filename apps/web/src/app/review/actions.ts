'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { detectInjection } from '@/lib/ai/injection-detector';
import { logAudit } from '@/lib/auth/audit';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { buildReviewCorpus, weeklyReviewSchema } from '@/lib/schemas/weekly-review';
import { submitWeeklyReview } from '@/lib/weekly-review/service';

/**
 * V1.8 REFLECT — Server Action for the WeeklyReview wizard.
 *
 * Pattern carbone `checkin/actions.ts` :
 *   - Re-call `auth()` at the top — defense in depth.
 *   - Re-validate `FormData` with the strict Zod schema.
 *   - Run the crisis-routing wire (Q4=A acted) — duplicate of
 *     `batch.ts:410` V1.7.1 but **persist QUAND MÊME** here (UX would
 *     break if we silently dropped a member's submission). HIGH /
 *     MEDIUM crisis = log audit + escalate Sentry parallel + carry
 *     the level in the redirect URL so the next page surfaces FR
 *     resources (3114, SOS Amitié, Suicide Écoute).
 *   - Run the prompt-injection pre-classifier (R5 axe 4 addendum) on
 *     the same corpus. Suspected = audit metadata + Sentry warning,
 *     **never block the submission** (false-positives must not eat
 *     the member's text). The XML wrap defense layer kicks in V2
 *     when this content reaches a Claude prompt.
 *   - Return a discriminated `ActionState` for `useActionState` —
 *     Zod field errors path keeps the wizard interactive.
 *   - Re-throw `NEXT_REDIRECT` so navigation isn't swallowed.
 */

export type WeeklyReviewCrisisLevel = 'high' | 'medium' | 'low' | 'none';

export interface WeeklyReviewActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** Mirrored from the server-side crisis detection so the UI can react. */
  crisisLevel?: WeeklyReviewCrisisLevel;
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
 * Next.js `redirect()` throws a `NEXT_REDIRECT` error to short-circuit
 * the Server Action. The error must be re-thrown so navigation happens —
 * any other catch path swallows it. Helper carbone from
 * `app/journal/actions.ts:60` (BUG-3 fix code-review 2026-05-14).
 */
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function submitWeeklyReviewAction(
  _prev: WeeklyReviewActionState | null,
  formData: FormData,
): Promise<WeeklyReviewActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    weekStart: getString(formData, 'weekStart'),
    biggestWin: getString(formData, 'biggestWin'),
    biggestMistake: getString(formData, 'biggestMistake'),
    bestPractice: getString(formData, 'bestPractice') || undefined,
    lessonLearned: getString(formData, 'lessonLearned'),
    nextWeekFocus: getString(formData, 'nextWeekFocus'),
  };

  const parsed = weeklyReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  // -------------------------------------------------------------------------
  // Crisis routing wire (V1.7.1 batch.ts:410 carbone, member-facing variant)
  // -------------------------------------------------------------------------

  const corpus = buildReviewCorpus(parsed.data);
  const crisis = detectCrisis(corpus);
  const matchedLabels = crisis.matches.map((m) => m.label);

  // -------------------------------------------------------------------------
  // Prompt-injection pre-classifier (R5 axe 4 addendum, dormant V1.8 but
  // audit trail starts collecting attempts now for V2 chatbot wiring).
  // -------------------------------------------------------------------------

  const injection = detectInjection(corpus);

  // -------------------------------------------------------------------------
  // Persist — Q4=A says persist EVEN IF crisis detected (UX over silent skip).
  // -------------------------------------------------------------------------

  let result;
  try {
    result = await submitWeeklyReview(session.user.id, parsed.data);
  } catch (err) {
    reportError('weekly-review.submit', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  // -------------------------------------------------------------------------
  // Audit trail — single `weekly_review.submitted` row carries every flag.
  // Crisis + injection get their own audit rows when triggered so a
  // forensic analyst can filter on the dedicated slugs.
  // -------------------------------------------------------------------------

  await logAudit({
    action: 'weekly_review.submitted',
    userId: session.user.id,
    metadata: {
      reviewId: result.review.id,
      weekStart: result.review.weekStart,
      wasNew: result.wasNew,
      crisisLevel: crisis.level,
      injectionSuspected: injection.suspected,
      ...(injection.suspected ? { injectionLabels: injection.matchedLabels } : {}),
    },
  });

  if (crisis.level === 'high' || crisis.level === 'medium') {
    await logAudit({
      action: 'weekly_review.crisis_detected',
      userId: session.user.id,
      metadata: {
        reviewId: result.review.id,
        weekStart: result.review.weekStart,
        level: crisis.level,
        matchedLabels,
      },
    });
    if (crisis.level === 'high') {
      reportError(
        'weekly-review.crisis',
        new Error(`crisis_signal_high_in_member_review: ${matchedLabels.join(',')}`),
        { userId: session.user.id, reviewId: result.review.id },
      );
    } else {
      reportWarning('weekly-review.crisis', 'crisis_signal_medium_in_member_review', {
        userId: session.user.id,
        reviewId: result.review.id,
        matchedLabels,
      });
    }
  }

  if (injection.suspected) {
    reportWarning('weekly-review.injection', 'prompt_injection_suspected', {
      userId: session.user.id,
      reviewId: result.review.id,
      matchedLabels: injection.matchedLabels,
    });
  }

  revalidatePath('/review');
  revalidatePath('/dashboard');

  // `redirect()` throws NEXT_REDIRECT — we re-throw to let the runtime
  // navigate. Any other error is logged + surfaced to the wizard so the
  // member doesn't sit on an infinite spinner (BUG-3 fix code-review
  // 2026-05-14, pattern carbone `app/journal/actions.ts:260`).
  const qs = new URLSearchParams({ done: '1' });
  if (crisis.level === 'high' || crisis.level === 'medium') {
    qs.set('crisis', crisis.level);
  }
  try {
    redirect(`/review?${qs.toString()}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    reportError('weekly-review.redirect', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }
}
