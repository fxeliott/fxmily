import { z } from 'zod';

import { localDateOf, shiftLocalDate } from '@/lib/checkin/timezone';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * V1.3 — `TrainingDebrief` Zod schema (SPEC §23, jalon #1 séquence §21.6).
 *
 * Single source of truth for the wizard's per-step validation AND the Server
 * Action re-validation. Server is the only authority.
 *
 * Mirrors `weekly-review.ts` (member free-text → DB, never to Claude in V1.3,
 * but Trojan-Source hardened anyway: the text renders in the member's own
 * timeline + Eliot's admin read-only view, and a future V2 chatbot may surface
 * excerpts in an IA context). Distinct concept though — this is the member's
 * BACKTEST-practice debrief, statistically isolated from the real edge (§21.5).
 *
 * Field model (mirrors the `TrainingDebrief` Prisma model):
 *   - 4 mandatory Steenbarger reverse-journaling free-text fields
 *     (2 process strengths + 1 micro-adjustment + 1 transversal lesson),
 *     10–4000 chars each after trim + NFC.
 *   - `weekStart` is the Monday of the debriefed week. We validate it IS a
 *     Monday and falls in a tight window. The process-stats panel is computed
 *     server-side from `TrainingTrade`/`TrainingAnnotation` (never sent by the
 *     client, never `resultR`/`outcome` — §23.2 strict process posture).
 *
 * Posture §2 / §23.7: zero P&L, zero market analysis, never judges the Lhedge
 * system. The schema only validates structure + hardens free-text.
 */

// =============================================================================
// Constants
// =============================================================================

export const TRAINING_DEBRIEF_TEXT_MIN_CHARS = 10;
export const TRAINING_DEBRIEF_TEXT_MAX_CHARS = 4000;
export const TRAINING_DEBRIEF_WEEK_PAST_HORIZON_DAYS = 35; // 5 weeks back
export const TRAINING_DEBRIEF_WEEK_FUTURE_HORIZON_DAYS = 7; // 1 week forward

const MIN_DATE = '2020-01-01';

// =============================================================================
// Field-level schemas
// =============================================================================

const requiredText = z
  .string()
  .trim()
  .min(TRAINING_DEBRIEF_TEXT_MIN_CHARS, `Au moins ${TRAINING_DEBRIEF_TEXT_MIN_CHARS} caractères.`)
  .max(TRAINING_DEBRIEF_TEXT_MAX_CHARS, `Maximum ${TRAINING_DEBRIEF_TEXT_MAX_CHARS} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/**
 * `weekStart` validator: ISO `YYYY-MM-DD` that
 *   (1) is a calendar-valid date,
 *   (2) is a Monday,
 *   (3) falls within `[-35d, +7d]` of *today in Europe/Paris*.
 *
 * Monday check uses an explicit `Date.UTC(y, m-1, d)` construction from the
 * validated integer parts (fully deterministic, tz-agnostic) + `getUTCDay()`.
 * That is the `weekly-review.ts` canon §23.4 points to — NOT a "naive input"
 * (`new Date(string).getUTCDay()`), which the §23.7 invariant forbids.
 *
 * The `[-35d, +7d]` window anchors "today" via `localDateOf(now,
 * 'Europe/Paris')` + `shiftLocalDate` — NOT `new Date().toISOString().slice(0,
 * 10)`. This is a deliberate hardening over the `weekly-review.ts` schema it
 * mirrors: §23.7 / invariant PR#96 (nocturnal flake) bans the UTC-slice for
 * any `@db.Date`-adjacent boundary. Europe/Paris is the V1 cohort timezone
 * (all members FR); a multi-tz V2 would thread `User.timezone` here.
 */
export const trainingDebriefWeekStartSchema = z
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
      // JS: 1 = Monday (Mon=1, Sun=0). Explicit UTC construction → deterministic.
      return d.getUTCDay() === 1;
    },
    { message: 'La semaine doit commencer un lundi.' },
  )
  .refine((s) => s >= MIN_DATE, { message: 'Date trop ancienne.' })
  .refine(
    (s) => {
      const todayParis = localDateOf(new Date(), 'Europe/Paris');
      const upper = shiftLocalDate(todayParis, TRAINING_DEBRIEF_WEEK_FUTURE_HORIZON_DAYS);
      return s <= upper;
    },
    { message: 'Date dans le futur.' },
  )
  .refine(
    (s) => {
      const todayParis = localDateOf(new Date(), 'Europe/Paris');
      const lower = shiftLocalDate(todayParis, -TRAINING_DEBRIEF_WEEK_PAST_HORIZON_DAYS);
      return s >= lower;
    },
    { message: `Date trop ancienne (>${TRAINING_DEBRIEF_WEEK_PAST_HORIZON_DAYS} j).` },
  );

// =============================================================================
// Main schema — Server Action input
// =============================================================================

export const trainingDebriefSchema = z
  .object({
    weekStart: trainingDebriefWeekStartSchema,
    /// Steenbarger reverse-journaling — process strength #1 (mandatory).
    processStrengthOne: requiredText,
    /// Process strength #2 (mandatory).
    processStrengthTwo: requiredText,
    /// One concrete micro-adjustment for next week (mandatory).
    microAdjustment: requiredText,
    /// The transversal lesson abstracted from the week (mandatory).
    transversalLesson: requiredText,
  })
  .strict();

export type TrainingDebriefInput = z.infer<typeof trainingDebriefSchema>;

// =============================================================================
// Helpers — server-only consumption
// =============================================================================

/**
 * Concatenate the four free-text fields for crisis-routing detection. The
 * Server Action hooks this into `detectCrisis(corpus)` before persist (mirror
 * REFLECT `buildReviewCorpus`). Order is deterministic — referenced in audit
 * metadata for forensics without ever storing the raw content.
 */
export function buildTrainingDebriefCorpus(input: TrainingDebriefInput): string {
  return [
    input.processStrengthOne,
    input.processStrengthTwo,
    input.microAdjustment,
    input.transversalLesson,
  ].join('\n');
}
