import { z } from 'zod';

import { TRAINING_KEY_PATTERN } from '@/lib/storage/keys';
import { TRADINGVIEW_URL_MAX, tradingViewUrlRequiredSchema } from '@/lib/schemas/tradingview-url';
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

/** Backtest result in R — OPTIONAL/nullable (a backtest may be logged before
 * its result is set, mirroring the real open/close split). Bounded to the
 * `resultR Decimal(6, 2)` DB column (`schema.prisma`): an out-of-range or
 * over-precise entry now surfaces a CLEAR field error instead of a generic
 * Postgres `numeric field overflow` swallowed as `error:'unknown'`. Unlike
 * `plannedRR`, a result may be NEGATIVE (a losing backtest). The `nullable`
 * short-circuits null (an empty/absent result) before the numeric checks. */
const resultRSchema = z.coerce
  .number({ message: 'Résultat R invalide.' })
  .gte(-9999.99, 'Le résultat R doit être compris entre -9999.99 et 9999.99.')
  .lte(9999.99, 'Le résultat R doit être compris entre -9999.99 et 9999.99.')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: 'Maximum 2 décimales (ex. 1.25).',
  })
  .nullable()
  .optional();

/** Entry-analysis screenshot key. Pattern sourced from `lib/storage/keys` so
 * the validation layer and the (J-T2) path-generation layer never drift —
 * same approach as `annotation.ts`. */
const trainingScreenshotKeySchema = z.string().regex(TRAINING_KEY_PATTERN, 'Clé fichier invalide.');

/** J1 — the training backtest now REQUIRES a TradingView link in place of the
 * former mandatory screenshot (pivot capture → lien, actée par Eliott). The
 * link validation + hardening (length cap, Trojan-Source reject, HTTPS-only +
 * tradingview.com host allowlist) lives in the shared `lib/schemas/
 * tradingview-url` module so the journal (entry + exit) and training surfaces
 * never drift. `TRAINING_TRADINGVIEW_URL_MAX` is re-exported as an alias of the
 * shared cap so existing importers/tests keep resolving. */
export const TRAINING_TRADINGVIEW_URL_MAX = TRADINGVIEW_URL_MAX;

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

/**
 * S8 V2 — one process-checklist item (brief §33-2). Tri-state like
 * `systemRespected` (`'true'` / `'false'` / `'na'` → boolean | null) but ALSO
 * `.optional()`: a member may submit a backtest without touching the checklist
 * (an absent item → `undefined`, normalised to `null` at the service layer).
 * These are DISCIPLINE acts, never affect values nor market judgement (§21.2 +
 * garde-fou §2): `emotionalStateNoted` records the ACT of observing one's state,
 * not the mood itself.
 */
const checklistItemSchema = z
  .union([z.boolean(), z.literal('na'), z.literal('true'), z.literal('false')])
  .transform((v) => {
    if (v === 'na') return null;
    if (typeof v === 'string') return v === 'true';
    return v;
  })
  .optional();

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
  // J1 — the TradingView link is now the mandatory entry artefact; the legacy
  // screenshot key is OPTIONAL (kept nullable in DB for pre-J1 backtests and
  // administrative repairs, never captured by the wizard anymore).
  entryScreenshotKey: trainingScreenshotKeySchema.optional(),
  // J1 — mandatory TradingView link (replaces the former screenshot upload).
  tradingViewUrl: tradingViewUrlRequiredSchema,
  plannedRR: plannedRRSchema,
  outcome: z.enum(OUTCOMES, { message: 'Résultat invalide.' }).nullable().optional(),
  resultR: resultRSchema,
  systemRespected: systemRespectedSchema,
  // S8 V2 — process-discipline checklist (brief §33-2). All optional/tri-state.
  planFollowed: checklistItemSchema,
  riskDefinedBefore: checklistItemSchema,
  emotionalStateNoted: checklistItemSchema,
  noImpulsiveDeviation: checklistItemSchema,
  lessonLearned: lessonLearnedSchema,
  enteredAt: enteredAtSchema,
});

export type TrainingTradeCreateInput = z.infer<typeof trainingTradeCreateSchema>;

/**
 * S8 V2 — the canonical process-checklist item descriptors. Single source of
 * truth shared by the wizard UI, the detail view and the guardrail test
 * (`training-checklist.guardrail.test.ts`), which feeds every `label` +
 * `help` through `detectAMFViolation` to prove zero market-analysis leakage.
 * Each `key` matches a `TrainingTrade` column + the create-schema field.
 */
export const TRAINING_CHECKLIST_ITEMS = [
  {
    key: 'planFollowed',
    label: "Plan d'exécution suivi",
    help: "As-tu suivi le plan que tu t'étais fixé avant ce backtest, sans improviser ?",
  },
  {
    key: 'riskDefinedBefore',
    label: 'Risque défini avant d’entrer',
    help: 'Avais-tu défini ton risque (taille, R:R) AVANT d’ouvrir la position ?',
  },
  {
    key: 'emotionalStateNoted',
    label: 'État émotionnel observé',
    help: 'As-tu pris un instant pour observer ton état (avant, pendant, après) — sans le laisser décider à ta place ?',
  },
  {
    key: 'noImpulsiveDeviation',
    label: 'Aucune déviation impulsive',
    help: 'Es-tu resté sur ton process du début à la fin, sans réaction impulsive ?',
  },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    TrainingTradeCreateInput,
    'planFollowed' | 'riskDefinedBefore' | 'emotionalStateNoted' | 'noImpulsiveDeviation'
  >;
  label: string;
  help: string;
}>;

export type TrainingChecklistKey = (typeof TRAINING_CHECKLIST_ITEMS)[number]['key'];
