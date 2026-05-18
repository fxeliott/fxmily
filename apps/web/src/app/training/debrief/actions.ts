'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { detectInjection } from '@/lib/ai/injection-detector';
import { logAudit } from '@/lib/auth/audit';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { submitTrainingDebrief } from '@/lib/training-debrief/service';
import { buildTrainingDebriefCorpus, trainingDebriefSchema } from '@/lib/schemas/training-debrief';

/**
 * V1.3 — Server Action for the `TrainingDebrief` wizard (SPEC §23).
 *
 * Carbone of `app/reflect/actions.ts` — crisis-routing wire +
 * prompt-injection pre-classifier, persist QUAND MÊME, audit-counts only.
 * The debrief is statistically isolated from the real edge (§21.5): it does
 * NOT revalidate `/dashboard` and feeds NOTHING into engagement/scoring —
 * faire un débrief n'alimente pas l'edge réel (SPEC §23.2 "aucun nouveau
 * couplage").
 */

export type TrainingDebriefCrisisLevel = 'high' | 'medium' | 'low' | 'none';

export interface TrainingDebriefActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
  crisisLevel?: TrainingDebriefCrisisLevel;
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

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function submitTrainingDebriefAction(
  _prev: TrainingDebriefActionState | null,
  formData: FormData,
): Promise<TrainingDebriefActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    weekStart: getString(formData, 'weekStart'),
    processStrengthOne: getString(formData, 'processStrengthOne'),
    processStrengthTwo: getString(formData, 'processStrengthTwo'),
    microAdjustment: getString(formData, 'microAdjustment'),
    transversalLesson: getString(formData, 'transversalLesson'),
  };

  const parsed = trainingDebriefSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const corpus = buildTrainingDebriefCorpus(parsed.data);
  const crisis = detectCrisis(corpus);
  const matchedLabels = crisis.matches.map((m) => m.label);
  const injection = detectInjection(corpus);

  let result;
  try {
    result = await submitTrainingDebrief(session.user.id, parsed.data);
  } catch (err) {
    reportError('training_debrief.create', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'training_debrief.submitted',
    userId: session.user.id,
    metadata: {
      debriefId: result.debrief.id,
      weekStart: result.debrief.weekStart,
      wasNew: result.wasNew,
      crisisLevel: crisis.level,
      injectionSuspected: injection.suspected,
      ...(injection.suspected ? { injectionLabels: injection.matchedLabels } : {}),
    },
  });

  if (crisis.level === 'high' || crisis.level === 'medium') {
    await logAudit({
      action: 'training_debrief.crisis_detected',
      userId: session.user.id,
      metadata: {
        debriefId: result.debrief.id,
        weekStart: result.debrief.weekStart,
        level: crisis.level,
        matchedLabels,
      },
    });
    if (crisis.level === 'high') {
      reportError(
        'training_debrief.crisis',
        new Error(`crisis_signal_high_in_training_debrief: ${matchedLabels.join(',')}`),
        { userId: session.user.id, debriefId: result.debrief.id },
      );
    } else {
      reportWarning('training_debrief.crisis', 'crisis_signal_medium_in_training_debrief', {
        userId: session.user.id,
        debriefId: result.debrief.id,
        matchedLabels,
      });
    }
  }

  if (injection.suspected) {
    reportWarning('training_debrief.injection', 'prompt_injection_suspected', {
      userId: session.user.id,
      debriefId: result.debrief.id,
      matchedLabels: injection.matchedLabels,
    });
  }

  // §21.5 — the debrief touches NO real-edge surface, so we revalidate ONLY
  // its own landing/timeline (no `/dashboard`, no scoring recompute).
  revalidatePath('/training/debrief');

  // Re-throw NEXT_REDIRECT, log + surface anything else (BUG-3 canon).
  const qs = new URLSearchParams({ done: '1' });
  if (crisis.level === 'high' || crisis.level === 'medium') {
    qs.set('crisis', crisis.level);
  }
  try {
    redirect(`/training/debrief?${qs.toString()}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    reportError('training_debrief.redirect', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }
}
