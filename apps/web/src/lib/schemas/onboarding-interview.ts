import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * V2.4 — `OnboardingInterviewAnswer` Zod schema (Session α, M3 directive 2026-05-27).
 *
 * Single source of truth for the onboarding interview wizard's per-step
 * validation AND the Server Action re-validation. Server is the only authority.
 *
 * Pattern carbone V1.8 REFLECT (Trojan-Source hardening + safeFreeText) +
 * V1.5 MindsetCheck (instrumentVersion-keyed question catalog) + V1.4
 * MonthlyDebrief (batch local Claude post-completion analysis).
 *
 * Field model (mirrors `OnboardingInterviewAnswer` Prisma model):
 *   - `questionIndex` (int, 0-based positional in instrumentVersion catalog)
 *   - `questionKey` (slug stable for analytics across instrumentVersion bumps)
 *   - `answerText` (free-text, 10–2000 chars after trim + NFC + bidi/zero-width strip)
 *
 * Posture §2 strict : answer text never echoes back to user verbatim (only
 * via Claude analysis pipeline Phase A.2 future). No setup/entry-signal regex
 * required at schema layer — that's the claude-client post-gen filter's job.
 *
 * Crisis/injection detection : applied at SERVICE layer (carbone V1.8 pattern,
 * see service.ts `appendAnswer`), NOT at schema layer. Schema = structure-only.
 */

// =============================================================================
// Constants
// =============================================================================

/** Min chars per answer after trim. ~3 words minimum. */
export const ONBOARDING_ANSWER_MIN_CHARS = 10;
/** Max chars per answer after trim. ~400 words generous for deep introspection. */
export const ONBOARDING_ANSWER_MAX_CHARS = 2000;
/** Question index bounds. 0-based, max 49 (instrument v1 expected ~30 questions). */
export const ONBOARDING_QUESTION_INDEX_MIN = 0;
export const ONBOARDING_QUESTION_INDEX_MAX = 49;
/** Question key slug regex: lowercase alphanumeric + dashes only. */
const QUESTION_KEY_REGEX = /^[a-z][a-z0-9_-]{2,63}$/;
/** Instrument version regex: `v` prefix + integer. */
const INSTRUMENT_VERSION_REGEX = /^v[1-9][0-9]*$/;

// =============================================================================
// Field-level schemas
// =============================================================================

const questionIndexSchema = z
  .number()
  .int('Index invalide.')
  .min(ONBOARDING_QUESTION_INDEX_MIN, 'Index invalide.')
  .max(ONBOARDING_QUESTION_INDEX_MAX, 'Index hors plage.');

const questionKeySchema = z
  .string()
  .regex(QUESTION_KEY_REGEX, 'Clé question invalide.')
  .max(64, 'Clé question trop longue.');

const answerTextSchema = z
  .string()
  .trim()
  .min(ONBOARDING_ANSWER_MIN_CHARS, `Au moins ${ONBOARDING_ANSWER_MIN_CHARS} caractères.`)
  .max(ONBOARDING_ANSWER_MAX_CHARS, `Maximum ${ONBOARDING_ANSWER_MAX_CHARS} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const instrumentVersionSchema = z
  .string()
  .regex(INSTRUMENT_VERSION_REGEX, "Version d'instrument invalide.");

// =============================================================================
// Main schemas — Server Action inputs
// =============================================================================

/**
 * Schema for `appendAnswer` Server Action (Phase B wizard frontend future).
 *
 * `instrumentVersion` is required so the server can validate `questionIndex`
 * + `questionKey` against the frozen catalog of that version (Phase A.2 future
 * — service layer will check via getOnboardingInstrument(version) helper).
 */
export const onboardingAnswerInputSchema = z
  .object({
    instrumentVersion: instrumentVersionSchema,
    questionIndex: questionIndexSchema,
    questionKey: questionKeySchema,
    answerText: answerTextSchema,
  })
  .strict();

export type OnboardingAnswerInput = z.infer<typeof onboardingAnswerInputSchema>;

/**
 * Schema for `startInterview` Server Action (Phase B wizard frontend future).
 *
 * Trivial input (just instrumentVersion). Service layer creates the row with
 * status='started' and assigns userId from session. Idempotent : if interview
 * already exists for userId, service returns existing row (no duplicate).
 */
export const onboardingStartInputSchema = z
  .object({
    instrumentVersion: instrumentVersionSchema,
  })
  .strict();

export type OnboardingStartInput = z.infer<typeof onboardingStartInputSchema>;

/**
 * Schema for `finalizeInterview` Server Action (Phase B wizard frontend future).
 *
 * No body input — service derives userId from session, looks up the row, and
 * flips status started/in_progress → completed. Idempotent : re-calling on
 * already-completed interview returns the row unchanged (no error).
 */
export const onboardingFinalizeInputSchema = z.object({}).strict();

export type OnboardingFinalizeInput = z.infer<typeof onboardingFinalizeInputSchema>;
