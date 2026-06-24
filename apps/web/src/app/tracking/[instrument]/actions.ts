'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';
import {
  resolveCurrentInstrument,
  submitTrackingEntry,
  UnknownInstrumentError,
} from '@/lib/tracking/service';

/**
 * V2 S2 — Server Action for the universal tracking engine (the member-facing
 * capture loop). Carbone of `app/mindset/actions.ts` with the same invariants:
 *
 *   - **Server is the only authority.** `responses` is rebuilt SERVER-SIDE from
 *     the resolved frozen instrument's question ids only — an unknown/extra key
 *     is structurally impossible — then re-validated instrument-strict inside
 *     `submitTrackingEntry` (`buildSubmissionSchema(instrument).parse`).
 *   - **Anti-tamper occurrence.** For a scheduled (weekly/daily) instrument the
 *     service IGNORES the client `occurrenceKey` and re-derives it from `now` —
 *     a member can't overwrite another period's slot.
 *   - **Posture §2.** The instrument is CLOSED (no free-text); nothing market-
 *     analysis can be persisted. Capturing never feeds scoring/triggers.
 *
 * Unlike the mindset action (§21.5 isolation → no `/dashboard` revalidate), this
 * one DOES `revalidatePath('/dashboard')` — but only so the count-only
 * completeness gauge refreshes. It feeds NOTHING into the real edge.
 */

export interface TrackingActionState {
  ok: boolean;
  error?: 'unauthorized' | 'unknown_instrument' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
}

function getString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

function flattenFieldErrors(error: ZodError): Record<string, string> {
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

export async function submitTrackingInstrumentAction(
  _prev: TrackingActionState | null,
  formData: FormData,
): Promise<TrackingActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const instrumentKey = getString(formData, 'instrumentKey');
  const instrument = resolveCurrentInstrument(instrumentKey);
  if (!instrument) {
    return { ok: false, error: 'unknown_instrument' };
  }

  // Server authority: only the resolved instrument's question ids are read.
  // A missing/empty answer is simply absent → the schema reports it for a
  // required question; an optional one is legitimately skipped.
  const responses: Record<string, unknown> = {};
  for (const q of instrument.questions) {
    const raw = formData.get(q.id);
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    switch (q.kind) {
      case 'boolean':
        if (raw === 'true' || raw === 'false') responses[q.id] = raw === 'true';
        break;
      case 'likert':
      case 'scale':
      case 'numeric': {
        const n = Number(raw);
        if (Number.isFinite(n)) responses[q.id] = n;
        break;
      }
      case 'single_choice':
        responses[q.id] = raw;
        break;
      case 'multi_tag': {
        try {
          const arr: unknown = JSON.parse(raw);
          if (Array.isArray(arr)) responses[q.id] = arr.filter((x) => typeof x === 'string');
        } catch {
          /* malformed multi-tag payload → drop (schema reports if required) */
        }
        break;
      }
    }
  }

  // D3 — optional confidence (1..5), only when the instrument captures it.
  // NB: an ABSENT field reads as '' and `Number('')` is 0 (not NaN), so guard
  // the empty string explicitly — otherwise a missing confidence would persist
  // as a phantom 0 (out of the 1..5 scale) instead of being legitimately absent.
  const confidenceRaw = getString(formData, 'confidenceLevel');
  const confidence =
    instrument.capturesConfidence && confidenceRaw !== '' ? Number(confidenceRaw) : NaN;
  // D2 — response latency (ms from wizard mount to submit), client-measured.
  // Same empty-string guard so an absent latency never becomes a phantom 0ms.
  const latencyRaw = getString(formData, 'responseLatencyMs');
  const latency = latencyRaw !== '' ? Number(latencyRaw) : NaN;

  const raw: Record<string, unknown> = {
    instrumentKey: instrument.key,
    instrumentVersion: instrument.version,
    occurrenceKey: getString(formData, 'occurrenceKey') || 'current',
    responses,
  };
  if (Number.isFinite(confidence)) raw.confidenceLevel = confidence;
  if (Number.isFinite(latency) && latency >= 0) raw.responseLatencyMs = latency;

  let occurrenceKey: string;
  try {
    const result = await submitTrackingEntry(session.user.id, raw, {
      timezone: session.user.timezone ?? 'Europe/Paris',
    });
    occurrenceKey = result.entry.occurrenceKey;
    // PII-free metadata (ids + occurrence + bool — never the responses payload).
    await logAudit({
      action: 'tracking_entry.submitted',
      userId: session.user.id,
      metadata: {
        instrumentKey: instrument.key,
        instrumentVersion: instrument.version,
        occurrenceKey,
        axis: instrument.axis,
        wasNew: result.wasNew,
      },
    });
  } catch (err) {
    if (err instanceof UnknownInstrumentError) {
      return { ok: false, error: 'unknown_instrument' };
    }
    if (err instanceof ZodError) {
      return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(err) };
    }
    reportError('tracking_entry.create', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }

  // The capture surface refreshes; the dashboard gauge is count-only (no edge).
  revalidatePath(`/tracking/${instrument.key}`);
  revalidatePath('/dashboard');

  // Calm reveal (§31.2): no streak/score in the URL.
  try {
    redirect(`/tracking/${instrument.key}?done=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    reportError('tracking_entry.redirect', err, { userId: session.user.id });
    return { ok: false, error: 'unknown' };
  }
}
