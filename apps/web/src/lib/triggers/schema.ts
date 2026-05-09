/**
 * Zod parser for `MarkDouglasCard.triggerRules` JSON column (J7).
 *
 * The DB column is `Json?`, so any shape can sneak in. Every read path MUST
 * pass the raw value through `parseTriggerRule` before passing it to the
 * evaluators — otherwise a malformed admin write could break the engine in
 * production. The reverse direction (write) goes through this same schema in
 * `lib/schemas/card.ts`.
 *
 * Discriminated by `kind`. The seven variants mirror `TriggerRule` in
 * `./types.ts`. We re-derive the type from Zod here (single source of truth).
 */

import { z } from 'zod';

import type { TriggerRule } from './types';

// =============================================================================
// Sub-schemas
// =============================================================================

const consecutiveLossesWindowSchema = z.enum(['any', 'rolling_24h', 'session']);

const douglasEmotionTagSchema = z.enum([
  // Trade slugs
  'fomo',
  'fear-loss',
  'fear-wrong',
  'fear-leaving-money',
  // Phase V/W (2026-05-09) — promotion V1.5 → V1. Ces 2 slugs existent
  // dans `lib/trading/emotions.ts` mais n'étaient pas câblés comme
  // triggers sur les fiches existantes (revenge-trade-trap +
  // sur-confiance). Désormais déclencheurs contextuels valides.
  'revenge-trade',
  'overconfident',
  // Check-in slugs
  'fearful',
  'greedy',
  'doubt',
]);

const positiveInt = (max: number) => z.number().int().min(1).max(max);

// =============================================================================
// Per-kind schemas
// =============================================================================

const afterNConsecutiveLossesSchema = z
  .object({
    kind: z.literal('after_n_consecutive_losses'),
    n: positiveInt(20),
    window: consecutiveLossesWindowSchema,
  })
  .strict();

const planViolationsInWindowSchema = z
  .object({
    kind: z.literal('plan_violations_in_window'),
    n: positiveInt(20),
    days: positiveInt(60),
  })
  .strict();

const sleepDeficitThenTradeSchema = z
  .object({
    kind: z.literal('sleep_deficit_then_trade'),
    minHours: z.number().min(0).max(12),
  })
  .strict();

const emotionLoggedSchema = z
  .object({
    kind: z.literal('emotion_logged'),
    tag: douglasEmotionTagSchema,
  })
  .strict();

const winStreakSchema = z
  .object({
    kind: z.literal('win_streak'),
    n: positiveInt(20),
  })
  .strict();

const noCheckinStreakSchema = z
  .object({
    kind: z.literal('no_checkin_streak'),
    days: positiveInt(60),
  })
  .strict();

const hedgeViolationSchema = z
  .object({
    kind: z.literal('hedge_violation'),
  })
  .strict();

// =============================================================================
// Union — single entry point
// =============================================================================

export const triggerRuleSchema: z.ZodType<TriggerRule> = z.discriminatedUnion('kind', [
  afterNConsecutiveLossesSchema,
  planViolationsInWindowSchema,
  sleepDeficitThenTradeSchema,
  emotionLoggedSchema,
  winStreakSchema,
  noCheckinStreakSchema,
  hedgeViolationSchema,
]);

/**
 * Parse a JSON value as a TriggerRule. Returns `null` on failure (logged at
 * the call site so admin can fix the offending card).
 */
export function parseTriggerRule(input: unknown): TriggerRule | null {
  const parsed = triggerRuleSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Throwing variant — for write paths where we want loud failures. */
export function parseTriggerRuleStrict(input: unknown): TriggerRule {
  return triggerRuleSchema.parse(input);
}
