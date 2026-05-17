import { z } from 'zod';

import { TRAINING_KEY_PATTERN } from '@/lib/storage/keys';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import { TRADING_PAIRS } from '@/lib/trading/pairs';

/**
 * Backtest entry schema (V1.2 Mode Entraînement, SPEC §21).
 *
 * Single source of truth for the `/training/new` wizard (J-T2) and its
 * Server Action re-validation — the server is the only authority. STATISTICAL
 * ISOLATION (SPEC §21.5): this lives in its own module, references no
 * real-edge schema, and a `TrainingTrade` never reaches `/journal`, scoring,
 * expectancy or the Habit×Trade correlation.
 *
 * Field set is lighter than `trade.ts` (SPEC §21.2): no emotions / sleep /
 * confidence — backtest affect ≠ real-risk affect (Mark Douglas). The
 * primitives (`pair`, `plannedRR`, the `systemRespected` tri-state, the
 * `enteredAt` bounds) are EXACT mirrors of `lib/schemas/trade.ts` so the two
 * surfaces stay consistent.
 *
 * `outcome` / `resultR` are nullable + optional here, mirroring the real
 * open/close split (`tradeOpenSchema` carries no outcome). The J-T2 wizard
 * may compose a stricter schema if the UX requires the result up front.
 */

const OUTCOMES = ['win', 'loss', 'break_even'] as const;

/** Hard upper bound on the lesson-learned free text. ~2 000 chars = a long
 * paragraph; mirrors `ADMIN_NOTE_BODY_MAX`. */
export const TRAINING_LESSON_MAX = 2000;

/** Allowlisted symbol, uppercase — exact mirror of `trade.ts` `pairSchema`. */
const pairSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (v): v is (typeof TRADING_PAIRS)[number] => (TRADING_PAIRS as readonly string[]).includes(v),
    { message: 'Paire non autorisée.' },
  );

/** Planned reward-to-risk — exact mirror of `trade.ts` `plannedRR`. */
const plannedRRSchema = z.coerce
  .number({ message: 'R:R invalide.' })
  .gte(0.25, 'Le R:R minimum est 0.25.')
  .lte(20, 'Le R:R maximum est 20.');

/** Entry-analysis screenshot key. Pattern sourced from `lib/storage/keys` so
 * the validation layer and the (J-T2) path-generation layer never drift —
 * same approach as `annotation.ts`. */
const trainingScreenshotKeySchema = z.string().regex(TRAINING_KEY_PATTERN, 'Clé fichier invalide.');

/** Lesson learned — mandatory free text, Fxmily Trojan-Source canon (exact
 * chain as `adminNoteCreateSchema` / annotation `comment`): reject
 * bidi/zero-width then `safeFreeText` (trim + NFC + strip). */
const lessonLearnedSchema = z
  .string()
  .trim()
  .min(1, 'La leçon tirée est obligatoire.')
  .max(TRAINING_LESSON_MAX, `Maximum ${TRAINING_LESSON_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/** Tri-state: true / false / null (= N/A). EXACT mirror of `trade.ts`
 * `hedgeRespected` — the form sends `'na'` for N/A. */
const systemRespectedSchema = z
  .union([z.boolean(), z.literal('na'), z.literal('true'), z.literal('false')])
  .transform((v) => {
    if (v === 'na') return null;
    if (typeof v === 'string') return v === 'true';
    return v;
  });

/** Backtest entry timestamp — EXACT mirror of `trade.ts` `enteredAt`
 * (plain instant, NOT a calendar day: no civil-window applies). */
const enteredAtSchema = z.coerce
  .date({ message: 'Date invalide.' })
  .min(new Date('2000-01-01'), { message: 'Date trop ancienne.' })
  .refine((d) => d.getTime() <= Date.now() + 60 * 60 * 1000, {
    message: 'Date dans le futur.',
  });

export const trainingTradeCreateSchema = z.object({
  pair: pairSchema,
  entryScreenshotKey: trainingScreenshotKeySchema,
  plannedRR: plannedRRSchema,
  outcome: z.enum(OUTCOMES, { message: 'Résultat invalide.' }).nullable().optional(),
  resultR: z.coerce.number({ message: 'Résultat R invalide.' }).nullable().optional(),
  systemRespected: systemRespectedSchema,
  lessonLearned: lessonLearnedSchema,
  enteredAt: enteredAtSchema,
});

export type TrainingTradeCreateInput = z.infer<typeof trainingTradeCreateSchema>;
