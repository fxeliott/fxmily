import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * V1.8 REFLECT — `WeeklyReview` Zod schema (member-facing Sunday recap).
 *
 * Single source of truth for the wizard's per-step validation (RHF) AND the
 * Server Action re-validation. Server is the only authority.
 *
 * Distinct from `weekly-report.ts` (admin-facing IA digest). Here the input
 * is **member free-text** going to DB — never to Claude. The Trojan-Source
 * defenses still apply (NFC + bidi/zero-width strip) because:
 *   1. The text renders in the member's own admin-visible journal.
 *   2. Future V2 chatbot may surface these excerpts in IA context.
 *
 * Field model (mirrors `WeeklyReview` Prisma model):
 *   - 4 mandatory free-text (biggestWin / biggestMistake / lessonLearned /
 *     nextWeekFocus), 10–4000 chars each after trim + NFC.
 *   - 1 optional free-text (bestPractice — Steenbarger reverse-journaling),
 *     same caps, collapses empty → null at the boundary.
 *   - `weekStart` is the Monday (UTC) of the reviewed week. We validate it
 *     IS a Monday and falls in a tight window (5 weeks back, 1 week forward
 *     for tz drift). `weekEnd` is **not** in the schema — service layer
 *     computes it server-side (`weekStart + 6d`) as a single source of truth.
 */

// =============================================================================
// Constants
// =============================================================================

export const REVIEW_TEXT_MIN_CHARS = 10;
export const REVIEW_TEXT_MAX_CHARS = 4000;
export const REVIEW_WEEK_PAST_HORIZON_DAYS = 35; // 5 weeks back
export const REVIEW_WEEK_FUTURE_HORIZON_DAYS = 7; // 1 week forward (tz drift)

const MIN_DATE = '2020-01-01';

// =============================================================================
// Field-level schemas
// =============================================================================

const requiredText = z
  .string()
  .trim()
  .min(REVIEW_TEXT_MIN_CHARS, `Au moins ${REVIEW_TEXT_MIN_CHARS} caractères.`)
  .max(REVIEW_TEXT_MAX_CHARS, `Maximum ${REVIEW_TEXT_MAX_CHARS} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const optionalText = z
  .string()
  .max(REVIEW_TEXT_MAX_CHARS, `Maximum ${REVIEW_TEXT_MAX_CHARS} caractères.`)
  .optional()
  .refine((v) => v == null || !containsBidiOrZeroWidth(v), {
    message: 'Caractères de contrôle interdits.',
  })
  .transform((v): string | null => {
    if (v == null) return null;
    const cleaned = safeFreeText(v);
    return cleaned === '' ? null : cleaned;
  });

/**
 * `weekStart` validator: ISO `YYYY-MM-DD` that
 *   (1) is a calendar-valid date,
 *   (2) is a Monday (UTC),
 *   (3) falls within `[-35d, +7d]` of today.
 *
 * The wizard auto-fills this from the client clock; the server re-validates
 * to defeat a malicious user submitting an arbitrarily ancient `weekStart`.
 */
export const weekStartMondaySchema = z
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
  .refine(
    (s) => {
      const [yearStr, monthStr, dayStr] = s.split('-');
      const d = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
      // JS: 1 = Monday (Mon=1, Sun=0). Use UTC reading.
      return d.getUTCDay() === 1;
    },
    { message: 'La semaine doit commencer un lundi.' },
  )
  .refine((s) => s >= MIN_DATE, { message: 'Date trop ancienne.' })
  .refine(
    (s) => {
      const today = new Date();
      today.setUTCDate(today.getUTCDate() + REVIEW_WEEK_FUTURE_HORIZON_DAYS);
      const upper = today.toISOString().slice(0, 10);
      return s <= upper;
    },
    { message: 'Date dans le futur.' },
  )
  .refine(
    (s) => {
      const horizon = new Date();
      horizon.setUTCDate(horizon.getUTCDate() - REVIEW_WEEK_PAST_HORIZON_DAYS);
      const lower = horizon.toISOString().slice(0, 10);
      return s >= lower;
    },
    { message: `Date trop ancienne (>${REVIEW_WEEK_PAST_HORIZON_DAYS} j).` },
  );

// =============================================================================
// Main schema — Server Action input
// =============================================================================

export const weeklyReviewSchema = z
  .object({
    weekStart: weekStartMondaySchema,
    biggestWin: requiredText,
    biggestMistake: requiredText,
    bestPractice: optionalText,
    lessonLearned: requiredText,
    nextWeekFocus: requiredText,
  })
  .strict();

export type WeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;

// =============================================================================
// Helpers — server-only consumption
// =============================================================================

/**
 * Compute the canonical `weekEnd` (Sunday UTC) from a validated Monday
 * `weekStart` (YYYY-MM-DD). Service-layer use only — never trusted from
 * client input. Returns a UTC Date pinned to 00:00:00.
 */
export function weekEndFromWeekStart(weekStart: string): Date {
  const [yearStr, monthStr, dayStr] = weekStart.split('-');
  const d = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

/**
 * Concatenate the free-text fields for crisis-routing detection. PR2 hooks
 * this into `detectCrisis(corpus)` before persist (Q4=A duplicate batch.ts
 * V1.7.1 pattern). The order is deterministic — referenced in audit metadata
 * for forensics without storing raw content.
 */
export function buildReviewCorpus(input: WeeklyReviewInput): string {
  return [
    input.biggestWin,
    input.biggestMistake,
    input.bestPractice ?? '',
    input.lessonLearned,
    input.nextWeekFocus,
  ].join('\n');
}
