'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { detectInjection } from '@/lib/ai/injection-detector';
import { logAudit } from '@/lib/auth/audit';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { createReflectionEntry } from '@/lib/reflection/service';
import { buildReflectionCorpus, reflectionEntrySchema } from '@/lib/schemas/reflection';

/**
 * V1.8 REFLECT — Server Action for the ReflectionEntry wizard (CBT Ellis ABCD).
 *
 * Same pattern as `app/review/actions.ts` — crisis-routing wire +
 * prompt-injection pre-classifier, persist QUAND MÊME, audit-counts only.
 * CBT clinical-disclaimer is a UI banner concern (PR future), the action
 * just persists what the Zod schema accepts.
 */

export type ReflectCrisisLevel = 'high' | 'medium' | 'low' | 'none';

export interface ReflectActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
  crisisLevel?: ReflectCrisisLevel;
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

export async function createReflectionEntryAction(
  _prev: ReflectActionState | null,
  formData: FormData,
): Promise<ReflectActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    date: getString(formData, 'date'),
    triggerEvent: getString(formData, 'triggerEvent'),
    beliefAuto: getString(formData, 'beliefAuto'),
    consequence: getString(formData, 'consequence'),
    disputation: getString(formData, 'disputation'),
  };

  const parsed = reflectionEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  const corpus = buildReflectionCorpus(parsed.data);
  const crisis = detectCrisis(corpus);
  const matchedLabels = crisis.matches.map((m) => m.label);
  const injection = detectInjection(corpus);

  let entry;
  try {
    entry = await createReflectionEntry(session.user.id, parsed.data);
  } catch (err) {
    reportError('reflection.create', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'reflection.submitted',
    userId: session.user.id,
    metadata: {
      reflectionId: entry.id,
      date: entry.date,
      crisisLevel: crisis.level,
      injectionSuspected: injection.suspected,
      ...(injection.suspected ? { injectionLabels: injection.matchedLabels } : {}),
    },
  });

  if (crisis.level === 'high' || crisis.level === 'medium') {
    await logAudit({
      action: 'reflection.crisis_detected',
      userId: session.user.id,
      metadata: {
        reflectionId: entry.id,
        date: entry.date,
        level: crisis.level,
        matchedLabels,
      },
    });
    if (crisis.level === 'high') {
      reportError(
        'reflection.crisis',
        new Error(`crisis_signal_high_in_reflection: ${matchedLabels.join(',')}`),
        { userId: session.user.id, reflectionId: entry.id },
      );
    } else {
      reportWarning('reflection.crisis', 'crisis_signal_medium_in_reflection', {
        userId: session.user.id,
        reflectionId: entry.id,
        matchedLabels,
      });
    }
  }

  if (injection.suspected) {
    reportWarning('reflection.injection', 'prompt_injection_suspected', {
      userId: session.user.id,
      reflectionId: entry.id,
      matchedLabels: injection.matchedLabels,
    });
  }

  revalidatePath('/reflect');
  revalidatePath('/dashboard');

  const qs = new URLSearchParams({ done: '1' });
  if (crisis.level === 'high' || crisis.level === 'medium') {
    qs.set('crisis', crisis.level);
  }
  redirect(`/reflect?${qs.toString()}`);
}
