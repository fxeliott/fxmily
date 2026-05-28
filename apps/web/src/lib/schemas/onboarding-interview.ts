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

// =============================================================================
// Phase A.2 — Snapshot input (handed to Claude batch) + MemberProfile output
// =============================================================================

/**
 * Constants — MemberProfile output schema bounds (Phase A.2).
 * Mirror weekly-report bounds where applicable; tuned for onboarding deep-
 * interview output (richer highlights, less risk-list scope).
 */
export const MEMBER_PROFILE_SUMMARY_MIN_CHARS = 100;
export const MEMBER_PROFILE_SUMMARY_MAX_CHARS = 800;

/** Each `highlight` represents one durable trait or pattern Claude inferred
 *  from the 30 answers. Min 3, max 7. */
export const MEMBER_PROFILE_HIGHLIGHTS_MIN = 3;
export const MEMBER_PROFILE_HIGHLIGHTS_MAX = 7;

/** Highlight `key` slug — kebab-case, mirrors instrument dimension naming. */
const MEMBER_PROFILE_HIGHLIGHT_KEY_REGEX = /^[a-z][a-z0-9_-]{2,79}$/;

export const MEMBER_PROFILE_HIGHLIGHT_LABEL_MAX_CHARS = 100;

/** Each `evidence` entry MUST be a verbatim substring of the concatenated
 *  answerTexts (NFC-normalized) — validated post-gen at the batch layer.
 *  Schema only enforces length. */
export const MEMBER_PROFILE_EVIDENCE_MIN_ITEMS = 1;
export const MEMBER_PROFILE_EVIDENCE_MAX_ITEMS = 5;
export const MEMBER_PROFILE_EVIDENCE_MAX_CHARS = 250;

export const MEMBER_PROFILE_AXES_MIN = 3;
export const MEMBER_PROFILE_AXES_MAX = 5;
export const MEMBER_PROFILE_AXIS_MAX_CHARS = 200;

const memberProfileHighlightSchema = z
  .object({
    key: z.string().regex(MEMBER_PROFILE_HIGHLIGHT_KEY_REGEX, 'Highlight key invalide.').max(80),
    label: z.string().min(3).max(MEMBER_PROFILE_HIGHLIGHT_LABEL_MAX_CHARS, 'Label trop long.'),
    evidence: z
      .array(
        z.string().min(1).max(MEMBER_PROFILE_EVIDENCE_MAX_CHARS, 'Evidence trop long (max 250).'),
      )
      .min(MEMBER_PROFILE_EVIDENCE_MIN_ITEMS, 'Au moins 1 evidence requise.')
      .max(MEMBER_PROFILE_EVIDENCE_MAX_ITEMS, 'Maximum 5 evidence par highlight.'),
  })
  .strict();

/**
 * Output schema Claude returns (Phase A.2 batch local).
 *
 * STRICT (`additionalProperties: false` equivalent via Zod `.strict()`) —
 * any extra key from the LLM = rejected before persist. Carbone V1.7
 * `weeklyReportOutputSchema` pattern (double-net : SDK structured-output
 * + Zod post-parse).
 *
 * Posture invariants enforced :
 *   - `summary` 100-800 chars FR descriptif-comportemental (PAS clinique).
 *   - `highlights[].evidence[]` MUST be verbatim substring of answer corpus
 *     (NFC-normalized) — validated post-gen at batch layer.
 *   - `axes_prioritaires` 3-5 axes pour coach Eliot.
 *
 * Anti-clinical wording (anti-pattern detection at batch layer) + AMF regex
 * post-gen + crisis routing pre-persist mirror V1.7.1.
 */
export const memberProfileOutputSchema = z
  .object({
    summary: z
      .string()
      .min(MEMBER_PROFILE_SUMMARY_MIN_CHARS, 'Summary trop court (min 100 chars).')
      .max(MEMBER_PROFILE_SUMMARY_MAX_CHARS, 'Summary trop long (max 800 chars).'),
    highlights: z
      .array(memberProfileHighlightSchema)
      .min(MEMBER_PROFILE_HIGHLIGHTS_MIN, 'Au moins 3 highlights requis.')
      .max(MEMBER_PROFILE_HIGHLIGHTS_MAX, 'Maximum 7 highlights.'),
    axes_prioritaires: z
      .array(
        z
          .string()
          .min(5)
          .max(MEMBER_PROFILE_AXIS_MAX_CHARS, 'Axe prioritaire trop long (max 200).'),
      )
      .min(MEMBER_PROFILE_AXES_MIN, 'Au moins 3 axes prioritaires requis.')
      .max(MEMBER_PROFILE_AXES_MAX, 'Maximum 5 axes prioritaires.'),
  })
  .strict();

export type MemberProfileOutput = z.infer<typeof memberProfileOutputSchema>;
export type MemberProfileHighlight = z.infer<typeof memberProfileHighlightSchema>;

/**
 * Snapshot input — handed to Claude via the user prompt.
 *
 * Pseudonymized (`pseudonymLabel: 'member-XXXXXXXX'` from V1.5.2 8-char hex).
 * NEVER includes real email/name/userId. The real userId travels separately
 * in the batch envelope for routing the result back.
 */
export interface OnboardingInterviewSnapshot {
  readonly pseudonymLabel: string;
  readonly instrumentVersion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly answers: ReadonlyArray<{
    readonly questionIndex: number;
    readonly questionKey: string;
    readonly questionText: string;
    readonly answerText: string;
    readonly dimensionId: string;
    readonly phase: 'warmup' | 'core' | 'reflective_close';
  }>;
}

// =============================================================================
// Phase A.2 — Batch persist HTTP request validation (CHECKPOINT 6)
// =============================================================================

/**
 * Validation schema for `POST /api/admin/onboarding-batch/persist` body.
 *
 * Mirror V1.7.2 `weekly-batch` Zod-strict + per-entry discriminated union.
 * Bounds tuned for onboarding (single-shot per member vs weekly cadence) :
 *   - Max 1000 entries per batch (≈ 30 V1 / scale guard V2+)
 *   - userId / interviewId max 40 chars (cuid 25 + nanoid 32 + marge V1.10 M3)
 */
export const ONBOARDING_BATCH_MAX_ENTRIES = 1000;

/** cuid V1.10 M3 tightening — same constraint as weekly-batch. */
const idSchema = z.string().min(1).max(40, 'ID trop long.');

// Plain union (vs discriminatedUnion) — wire format stays minimal, no `kind`
// field required. TypeScript narrows via `'error' in entry` structural check
// in `batch.ts:persistGeneratedProfiles`. Zod parses by trying each variant
// in order — output variant first (most common path), error variant fallback.
const batchResultEntrySchema = z.union([
  z
    .object({
      userId: idSchema,
      interviewId: idSchema,
      output: memberProfileOutputSchema, // ← double-net Zod strict layer 2
      usage: z
        .object({
          inputTokens: z.number().int().min(0).max(1_000_000),
          outputTokens: z.number().int().min(0).max(1_000_000),
          cacheReadTokens: z.number().int().min(0).max(1_000_000).optional(),
        })
        .strict()
        .optional(),
      model: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      userId: idSchema,
      interviewId: idSchema,
      error: z.string().min(1).max(2000),
    })
    .strict(),
]);

/**
 * Top-level batch persist request schema. The local script POSTs this body
 * after running `claude --print` N times for the N entries pulled. Server
 * re-validates every entry via this schema before passing to
 * `persistGeneratedProfiles` (defense-in-depth — never trust the laptop).
 *
 * Wire format aligns with `BatchResultEntry` TypeScript union in `batch.ts` —
 * each result is either `{userId, interviewId, output, usage?, model?}` (success)
 * or `{userId, interviewId, error}` (claude failure). TypeScript narrows via
 * `'error' in entry` structural check.
 */
export const batchPersistRequestSchema = z
  .object({
    results: z
      .array(batchResultEntrySchema)
      .min(1, 'Au moins 1 résultat requis.')
      .max(
        ONBOARDING_BATCH_MAX_ENTRIES,
        `Maximum ${ONBOARDING_BATCH_MAX_ENTRIES} résultats par batch.`,
      ),
  })
  .strict();

export type BatchPersistRequestInput = z.infer<typeof batchPersistRequestSchema>;
