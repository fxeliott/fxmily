import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * V1.8 REFLECT — `ReflectionEntry` Zod schema (CBT Ellis ABCD).
 *
 * Single source of truth for the daily reflection wizard's per-step validation
 * AND the Server Action re-validation. Server is the only authority.
 *
 * Disclaimer surfaced UI-side (wizard banner, PR2):
 *   "inspired by Ellis ABC, adapted for trading — not clinically validated for
 *   trader population".
 *
 * Field model (mirrors `ReflectionEntry` Prisma model):
 *   - 4 mandatory free-text fields (A / B / C / D), 10–2000 chars each after
 *     trim + NFC.
 *   - 1 `date` (local civil date YYYY-MM-DD), within `[-14d, +1d]` of today
 *     (UTC). Daily granularity — multiple entries per day are allowed (no
 *     `@@unique([userId, date])` at DB level).
 *
 * Trojan-Source hardening (NFC + bidi/zero-width strip) applies to all four
 * free-text fields. Rationale: future V2 chatbot may surface excerpts in IA
 * context AND the admin reflection view may render the text server-side.
 */

// =============================================================================
// Constants
// =============================================================================

export const REFLECTION_TEXT_MIN_CHARS = 10;
export const REFLECTION_TEXT_MAX_CHARS = 2000;
export const REFLECTION_PAST_HORIZON_DAYS = 14;
export const REFLECTION_FUTURE_HORIZON_DAYS = 1; // tz drift only

const MIN_DATE = '2020-01-01';

// =============================================================================
// Field-level schemas
// =============================================================================

const requiredAbcdField = z
  .string()
  .trim()
  .min(REFLECTION_TEXT_MIN_CHARS, `Au moins ${REFLECTION_TEXT_MIN_CHARS} caractères.`)
  .max(REFLECTION_TEXT_MAX_CHARS, `Maximum ${REFLECTION_TEXT_MAX_CHARS} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const reflectionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
  .refine(
    (s) => {
      const [yearStr, monthStr, dayStr] = s.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const d = new Date(Date.UTC(year, month - 1, day));
      return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
    },
    { message: 'Date calendaire invalide.' },
  )
  .refine((s) => s >= MIN_DATE, { message: 'Date trop ancienne.' })
  .refine(
    (s) => {
      const today = new Date();
      today.setUTCDate(today.getUTCDate() + REFLECTION_FUTURE_HORIZON_DAYS);
      return s <= today.toISOString().slice(0, 10);
    },
    { message: 'Date dans le futur.' },
  )
  .refine(
    (s) => {
      const horizon = new Date();
      horizon.setUTCDate(horizon.getUTCDate() - REFLECTION_PAST_HORIZON_DAYS);
      return s >= horizon.toISOString().slice(0, 10);
    },
    { message: `Date trop ancienne (>${REFLECTION_PAST_HORIZON_DAYS} j).` },
  );

// =============================================================================
// Main schema — Server Action input
// =============================================================================

export const reflectionEntrySchema = z
  .object({
    date: reflectionDateSchema,
    /// A — Activating event (factual trigger).
    triggerEvent: requiredAbcdField,
    /// B — Automatic belief (the thought that fired).
    beliefAuto: requiredAbcdField,
    /// C — Consequence (emotion + behavior observed).
    consequence: requiredAbcdField,
    /// D — Disputation / reframe (alternative belief).
    disputation: requiredAbcdField,
  })
  .strict();

export type ReflectionEntryInput = z.infer<typeof reflectionEntrySchema>;

// =============================================================================
// Helpers — server-only consumption
// =============================================================================

/**
 * Concatenate the four ABCD fields for crisis-routing detection. PR2 hooks
 * this into `detectCrisis(corpus)` before persist (Q4=A duplicate batch.ts
 * V1.7.1 pattern). Order is deterministic — referenced in audit metadata
 * for forensics without storing raw content.
 */
export function buildReflectionCorpus(input: ReflectionEntryInput): string {
  return [input.triggerEvent, input.beliefAuto, input.consequence, input.disputation].join('\n');
}
