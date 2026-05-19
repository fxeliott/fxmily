'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { getMindsetInstrument } from '@/lib/mindset/instrument';
import { submitMindsetCheck } from '@/lib/mindset/service';
import { reportError } from '@/lib/observability';
import { mindsetCheckSchema } from '@/lib/schemas/mindset-check';

/**
 * V1.5 — Server Action for the `MindsetCheck` instrument (SPEC §27).
 *
 * Carbone of `app/training/debrief/actions.ts` with a DELIBERATE divergence
 * (SPEC §27.6/§27.7): the instrument is 100 % closed (Likert only) — ZERO
 * free-text — so there is NO crisis-routing / prompt-injection corpus to
 * scan (no `detectCrisis`/`detectInjection` import; that surface does not
 * exist by design). Statistically isolated from the real edge (§21.5/§27.7):
 * it does NOT `revalidatePath('/dashboard')` and feeds NOTHING into
 * scoring / engagement / triggers — passer le QCM n'alimente pas l'edge réel.
 *
 * Server is the only authority: `responses` is rebuilt server-side from the
 * resolved instrument's item ids (an unknown/extra key is structurally
 * impossible), then `mindsetCheckSchema` re-validates the whole payload.
 */

export interface MindsetCheckActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
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

export async function submitMindsetCheckAction(
  _prev: MindsetCheckActionState | null,
  formData: FormData,
): Promise<MindsetCheckActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const weekStart = getString(formData, 'weekStart');
  const instrumentVersion = Number.parseInt(getString(formData, 'instrumentVersion'), 10);

  // Server authority: only the resolved instrument's item ids are accepted —
  // an unknown/extra key cannot enter `responses`. A missing/empty answer is
  // simply absent → the schema reports "Réponse manquante" for it.
  const instrument = Number.isFinite(instrumentVersion)
    ? getMindsetInstrument(instrumentVersion)
    : undefined;
  const responses: Record<string, number> = {};
  if (instrument) {
    for (const item of instrument.items) {
      const raw = formData.get(item.id);
      if (typeof raw === 'string' && raw.trim() !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) responses[item.id] = n;
      }
    }
  }

  const parsed = mindsetCheckSchema.safeParse({
    weekStart,
    instrumentVersion,
    responses,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let result;
  try {
    result = await submitMindsetCheck(session.user.id, parsed.data);
  } catch (err) {
    reportError('mindset_check.create', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  // PII-free (ids + week + version + bool — never the responses payload).
  await logAudit({
    action: 'mindset_check.submitted',
    userId: session.user.id,
    metadata: {
      checkId: result.check.id,
      weekStart: result.check.weekStart,
      instrumentVersion: result.check.instrumentVersion,
      wasNew: result.wasNew,
    },
  });

  // §21.5/§27.7 — the mindset check touches NO real-edge surface, so we
  // revalidate ONLY its own landing/timeline (no `/dashboard`, no scoring
  // recompute, no trigger dispatch).
  revalidatePath('/mindset');

  // Calm reveal, anti Black-Hat (§27.4): no XP/streak/score in the URL.
  try {
    redirect('/mindset?done=1');
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    reportError('mindset_check.redirect', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }
}
