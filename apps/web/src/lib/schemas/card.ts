/**
 * Zod schemas for `MarkDouglasCard` (J7).
 *
 * Three layers:
 *   - `cardCreateSchema`     — admin "create card" form. Requires all fields.
 *   - `cardUpdateSchema`     — admin "edit card" form. All fields optional.
 *   - `cardExerciseSchema`   — sub-schema for the `exercises` JSON column.
 *
 * Hardening:
 *   - `quote`     ≤ 30 words (fair use FR L122-5, SPEC §18.2 enforced).
 *   - `paraphrase` 50–4000 chars + `safeFreeText` (NFC + bidi/zero-width strip)
 *     to bridge the J5 audit MEDIUM M5 fix and stay safe for J8 LLM prompts.
 *   - `slug` URL-safe lowercase.
 *   - `triggerRules` re-uses `triggerRuleSchema` from `lib/triggers/schema.ts`.
 *   - `hatClass` `'white' | 'black'`.
 *   - `priority` 1–10.
 *   - `category` matches the `DouglasCategory` Prisma enum.
 *   - `quoteSourceChapter` non-empty (every quote MUST carry attribution).
 *
 * Categories list mirrors `prisma/schema.prisma` `DouglasCategory` enum.
 */

import { z } from 'zod';

import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { containsBidiOrZeroWidth, graphemeCount, safeFreeText } from '@/lib/text/safe';
import { triggerRuleSchema } from '@/lib/triggers/schema';

// =============================================================================
// Constants
// =============================================================================

export const DOUGLAS_CATEGORIES = [
  'acceptance',
  'tilt',
  'discipline',
  'ego',
  'probabilities',
  'confidence',
  'patience',
  'consistency',
  'fear',
  'loss',
  'process',
] as const;

export const HAT_CLASSES = ['white', 'black'] as const;

export const QUOTE_MAX_WORDS = 30;
export const PARAPHRASE_MIN_CHARS = 50;
export const PARAPHRASE_MAX_CHARS = 4000;
export const TITLE_MAX_CHARS = 120;
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const QUOTE_SOURCE_MIN_CHARS = 4;
export const QUOTE_SOURCE_MAX_CHARS = 200;
export const EXERCISE_LABEL_MAX = 80;
export const EXERCISE_DESCRIPTION_MAX = 600;
export const EXERCISES_MIN = 1;
export const EXERCISES_MAX = 3;

// =============================================================================
// Sub-schemas
// =============================================================================

const slugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(SLUG_REGEX, 'Slug doit être en kebab-case lowercase (a-z, 0-9, -).');

const titleSchema = z
  .string()
  .trim()
  .min(3)
  .max(TITLE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const quoteSchema = z
  .string()
  .trim()
  .min(4)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  .refine((s) => wordCount(s) <= QUOTE_MAX_WORDS, {
    message: `Citation trop longue (max ${QUOTE_MAX_WORDS} mots, fair use FR).`,
  });

const quoteSourceChapterSchema = z
  .string()
  .trim()
  .min(QUOTE_SOURCE_MIN_CHARS)
  .max(QUOTE_SOURCE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const paraphraseSchema = z
  .string()
  .min(PARAPHRASE_MIN_CHARS)
  .max(PARAPHRASE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  .refine((s) => graphemeCount(s) >= PARAPHRASE_MIN_CHARS, {
    message: `Paraphrase trop courte (min ${PARAPHRASE_MIN_CHARS} caractères).`,
  });

export const cardExerciseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'id kebab-case'),
    label: z
      .string()
      .trim()
      .min(3)
      .max(EXERCISE_LABEL_MAX)
      .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
      .transform(safeFreeText),
    description: z
      .string()
      .trim()
      .min(10)
      .max(EXERCISE_DESCRIPTION_MAX)
      .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
      .transform(safeFreeText),
  })
  .strict();

export const cardExercisesSchema = z
  .array(cardExerciseSchema)
  .min(EXERCISES_MIN)
  .max(EXERCISES_MAX);

const categorySchema = z.enum(DOUGLAS_CATEGORIES);
const hatClassSchema = z.enum(HAT_CLASSES);
const prioritySchema = z.number().int().min(1).max(10);

// =============================================================================
// Create / update
// =============================================================================

// Base object (NON-refined) — `.partial()` must apply to THIS, never to the
//   refined schema. S5 13e challenge fix : `cardCreateSchema.partial()` crashait
//   (zod refuse `.partial()` sur un ZodEffects/superRefine) → tout le module
//   `card.ts` était un-importable au runtime, ce qui a aussi désactivé le SEUL
//   gate de validation seed→schema (donc une quote 31 mots > cap est passée).
const cardObjectSchema = z
  .object({
    slug: slugSchema,
    title: titleSchema,
    category: categorySchema,
    quote: quoteSchema,
    quoteSourceChapter: quoteSourceChapterSchema,
    paraphrase: paraphraseSchema,
    exercises: cardExercisesSchema,
    triggerRules: triggerRuleSchema.nullable(),
    hatClass: hatClassSchema.default('white'),
    priority: prioritySchema.default(5),
    published: z.boolean().default(false),
  })
  .strict();

/**
 * SPEC §2 posture invariant — no market-analysis advice in member-facing content.
 * Concatenates every text field the member reads and runs the AMF detector.
 * Null-safe (fields optional) so it works on BOTH create (full) and update (partial).
 */
function assertNoMarketAdvice(
  card: {
    title?: string | undefined;
    quote?: string | undefined;
    paraphrase?: string | undefined;
    exercises?: ReadonlyArray<{ label: string; description: string }> | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const exerciseText = (card.exercises ?? [])
    .flatMap((ex) => [ex.label, ex.description])
    .join('\n\n');
  const corpus = [card.title, card.quote, card.paraphrase, exerciseText]
    .filter(Boolean)
    .join('\n\n');
  if (detectAMFViolation(corpus).suspected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Contenu interdit (§2) : une fiche ne peut pas contenir de conseil d'analyse de marché.",
      path: ['paraphrase'],
    });
  }
}

export const cardCreateSchema = cardObjectSchema.superRefine(assertNoMarketAdvice);

export type CardCreateInput = z.infer<typeof cardCreateSchema>;

// `.partial()` on the UNREFINED object (no crash), then re-apply the §2 refine.
export const cardUpdateSchema = cardObjectSchema.partial().superRefine(assertNoMarketAdvice);

export type CardUpdateInput = z.infer<typeof cardUpdateSchema>;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Naive word count — splits on whitespace runs after trimming. Sufficient
 * for the SPEC §18.2 ≤ 30-word fair-use cap. We don't over-engineer with
 * Intl.Segmenter here because Mark Douglas quotes are well-behaved English.
 */
export function wordCount(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}
