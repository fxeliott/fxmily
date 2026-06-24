/**
 * V2 S2 — Zod validation for tracking submissions, BUILT from the instrument.
 *
 * Single source of truth for the wizard's validation AND the Server Action
 * re-validation (server is the only authority). PURE — no `server-only` — so
 * the client can validate before submit, but the server ALWAYS re-validates.
 *
 * The `responses` object is validated STRICTLY against the frozen instrument
 * identified by `(instrumentKey, instrumentVersion)`:
 *   - every REQUIRED question must be answered;
 *   - each value matches its question kind (boolean / 1..5 / option value / …);
 *   - NO unknown question id is allowed (`.strict()`-equivalent).
 * Mirror of the MindsetCheck cross-field validator (§27.3/§27.4). Closed
 * instrument ⇒ ZERO free-text ⇒ no crisis/injection corpus by design (§27.6).
 *
 * POSTURE §2: structure-only validation, zero P&L, zero market-analysis field.
 */

import { z } from 'zod';

import type { CaptureContextValue, TrackingInstrument, TrackingQuestion } from './types';

/** Hard cap on `occurrenceKey` / `instrumentKey` lengths (anti-abuse). */
const KEY_MAX = 64;

const captureContextSchema: z.ZodType<CaptureContextValue> = z.enum(['hot', 'cold', 'scheduled']);

/** Per-question value schema, derived from the question kind. */
function questionValueSchema(q: TrackingQuestion): z.ZodTypeAny {
  switch (q.kind) {
    case 'boolean':
      return z.boolean();
    case 'likert':
      return z.number().int().min(1).max(5);
    case 'scale':
      return z.number().int().min(q.min).max(q.max);
    case 'numeric': {
      const base = q.integer ? z.number().int() : z.number();
      return base.min(q.min).max(q.max);
    }
    case 'single_choice': {
      const values = q.options.map((o) => o.value);
      return z.string().refine((v) => values.includes(v), { message: 'unknown_option' });
    }
    case 'multi_tag': {
      const values = q.options.map((o) => o.value);
      const element = z.string().refine((v) => values.includes(v), { message: 'unknown_option' });
      const baseArray = z.array(element);
      // The server is the SOLE authority on "answered": a REQUIRED multi_tag must
      // carry ≥1 tag, so a tampered literal `[]` can't pass as a non-answer (the
      // wizard already sends '' for an empty selection → absent → required-missing,
      // but Zod must close the hole too). `.min(1)` lives on the base ZodArray —
      // after a `.refine` the type widens to ZodEffects without `.min`. An OPTIONAL
      // multi_tag may legitimately be empty. The chain stays typed (no widening to
      // ZodTypeAny) so the refine callbacks see `string[]`.
      const required = q.required !== false;
      const deduped = (required ? baseArray.min(1, { message: 'required' }) : baseArray).refine(
        (xs) => new Set(xs).size === xs.length,
        { message: 'duplicate_tag' },
      );
      const cap = q.maxSelected;
      return typeof cap === 'number'
        ? deduped.refine((xs) => xs.length <= cap, { message: 'too_many_tags' })
        : deduped;
    }
  }
}

/**
 * Build the strict `responses` schema for an instrument: a closed object whose
 * keys are exactly the question ids, required/optional per question, no extras.
 */
export function buildResponsesSchema(instrument: TrackingInstrument): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of instrument.questions) {
    const value = questionValueSchema(q);
    shape[q.id] = q.required === false ? value.optional() : value;
  }
  // `.strict()` rejects any unknown question id — no silent extra payload.
  return z.object(shape).strict();
}

/** The validated, JSON-safe submission the service persists. */
export interface TrackingSubmission {
  instrumentKey: string;
  instrumentVersion: string;
  occurrenceKey: string;
  responses: Record<string, unknown>;
  confidenceLevel?: number;
  captureContext?: CaptureContextValue;
  responseLatencyMs?: number;
  promptedAt?: string; // ISO
}

/**
 * Build the full submission schema for an instrument. The `responses` branch is
 * instrument-strict; the metadata (D2/D3) is optional and bounded.
 *   - `confidenceLevel`: 1..5, allowed only when the instrument captures it.
 *   - `responseLatencyMs`: 0..86_400_000 (≤ 24h — anything larger is a bug).
 *   - `promptedAt`: ISO datetime string.
 */
export function buildSubmissionSchema(
  instrument: TrackingInstrument,
): z.ZodType<TrackingSubmission> {
  const confidence = instrument.capturesConfidence
    ? z.number().int().min(1).max(5).optional()
    : z.undefined();

  return z.object({
    instrumentKey: z.literal(instrument.key),
    instrumentVersion: z.literal(instrument.version),
    occurrenceKey: z.string().min(1).max(KEY_MAX),
    responses: buildResponsesSchema(instrument),
    confidenceLevel: confidence,
    captureContext: captureContextSchema.optional(),
    responseLatencyMs: z.number().int().min(0).max(86_400_000).optional(),
    promptedAt: z.string().datetime({ offset: true }).optional(),
  }) as unknown as z.ZodType<TrackingSubmission>;
}
