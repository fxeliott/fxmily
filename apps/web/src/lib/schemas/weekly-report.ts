/**
 * Zod schemas for `WeeklyReport` (J8 — Phase A foundation).
 *
 * Three layers:
 *   - `weeklyReportInputSchema`  — what the builder produces from DB data,
 *                                  fed to Claude Sonnet 4.6 as user prompt.
 *   - `weeklyReportOutputSchema` — what Claude is expected to return (JSON
 *                                  strict). Validated post-`messages.parse()`
 *                                  in double-net (enum fuzzing defense).
 *   - `weeklyReportPersistedSchema` — what we write to the DB (combines
 *                                  output + cost metrics + dispatch state).
 *
 * Hardening :
 *   - `safeFreeText` (NFC + bidi/zero-width strip) on every free-text field
 *     that originates from member input. **CRITIQUE** for prompt injection
 *     defense (Trojan Source) before sending to Claude (J5 audit M5 + J7
 *     carbone).
 *   - `summary` / risks / recommendations also pass through `safeFreeText`
 *     post-Claude — defense-in-depth in case Claude ever returns content
 *     with bidi/zero-width control chars.
 *   - `.strict()` on output schema rejects any extra keys the LLM might
 *     hallucinate.
 *   - `risks` / `recommendations` capped at max 5 items, each 20-300 chars.
 *
 * Note: this file is **server-only** at import time only insofar as it
 * imports `@/lib/text/safe`. Both should already be on the server boundary;
 * no client component imports them.
 */

import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

// =============================================================================
// Constants
// =============================================================================

export const SUMMARY_MIN_CHARS = 100;
export const SUMMARY_MAX_CHARS = 800;
export const ITEM_MIN_CHARS = 20;
export const ITEM_MAX_CHARS = 300;
export const RISKS_MIN = 0;
export const RISKS_MAX = 5;
export const RECOMMENDATIONS_MIN = 1;
export const RECOMMENDATIONS_MAX = 5;
export const PATTERN_VALUE_MAX_CHARS = 400;

// Free-text item — free-form string with anti-injection hardening.
const safeItemSchema = z
  .string()
  .trim()
  .min(ITEM_MIN_CHARS)
  .max(ITEM_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const safeSummarySchema = z
  .string()
  .trim()
  .min(SUMMARY_MIN_CHARS)
  .max(SUMMARY_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const safePatternValueSchema = z
  .string()
  .trim()
  .max(PATTERN_VALUE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

// =============================================================================
// Patterns object — what the builder summarizes from analytics
// =============================================================================

/// Patterns extracted from the 7-day window. All optional — the builder may
/// omit a pattern when sample size is insufficient (cf. J6 sample-size guards).
export const weeklyReportPatternsSchema = z
  .object({
    /// Emotion → outcome pattern (ex: "FOMO win rate 23% vs Calme 67% sur 14 trades").
    emotionPerf: safePatternValueSchema.optional(),
    /// Sleep × performance pattern (ex: "<6h sommeil → -0.4R moyen sur 5 trades").
    sleepPerf: safePatternValueSchema.optional(),
    /// Session focus pattern (ex: "78% trades en session London cette semaine").
    sessionFocus: safePatternValueSchema.optional(),
    /// Discipline trajectory (ex: "Plan respect rate 82% (vs 71% semaine -1)").
    disciplineTrend: safePatternValueSchema.optional(),
  })
  .strict();

export type WeeklyReportPatterns = z.infer<typeof weeklyReportPatternsSchema>;

// =============================================================================
// Output schema — what Claude must return (JSON strict)
// =============================================================================

/// What we expect Claude Sonnet 4.6 to return via `output_config.format`.
/// Validated TWICE: once at SDK level via the structured-output schema, once
/// post-`messages.parse()` here as a double-net against enum fuzzing or
/// formatting drift.
export const weeklyReportOutputSchema = z
  .object({
    summary: safeSummarySchema,
    risks: z.array(safeItemSchema).min(RISKS_MIN).max(RISKS_MAX),
    recommendations: z.array(safeItemSchema).min(RECOMMENDATIONS_MIN).max(RECOMMENDATIONS_MAX),
    patterns: weeklyReportPatternsSchema,
  })
  .strict();

export type WeeklyReportOutput = z.infer<typeof weeklyReportOutputSchema>;

// =============================================================================
// Cost-tracking schema — what we persist alongside output
// =============================================================================

export const weeklyReportCostSchema = z
  .object({
    claudeModel: z.string().min(4).max(80),
    inputTokens: z.number().int().min(0).max(2_000_000),
    outputTokens: z.number().int().min(0).max(50_000),
    cacheReadTokens: z.number().int().min(0).max(2_000_000).default(0),
    cacheCreateTokens: z.number().int().min(0).max(2_000_000).default(0),
    /// Cost in EUR with 6 decimals precision (sub-cent tracking, SPEC §16).
    costEur: z
      .union([z.number(), z.string()])
      .transform((v) => (typeof v === 'string' ? v : v.toFixed(6))),
  })
  .strict();

export type WeeklyReportCost = z.infer<typeof weeklyReportCostSchema>;

// =============================================================================
// Persisted schema — combines output + cost + dispatch (DB write)
// =============================================================================

export const weeklyReportPersistInputSchema = weeklyReportOutputSchema.extend({
  userId: z.string().min(1).max(64),
  weekStart: z.date(),
  weekEnd: z.date(),
  cost: weeklyReportCostSchema,
});

export type WeeklyReportPersistInput = z.infer<typeof weeklyReportPersistInputSchema>;

// =============================================================================
// Snapshot schema — what the builder produces from DB (input to Claude)
// =============================================================================

/// Counters slice — pure numerics, never user-controlled text.
const counterSliceSchema = z
  .object({
    tradesTotal: z.number().int().min(0),
    tradesWin: z.number().int().min(0),
    tradesLoss: z.number().int().min(0),
    tradesBreakEven: z.number().int().min(0),
    tradesOpen: z.number().int().min(0),
    realizedRSum: z.number(),
    realizedRMean: z.number().nullable(),
    planRespectRate: z.number().min(0).max(1).nullable(),
    hedgeRespectRate: z.number().min(0).max(1).nullable(),
    morningCheckinsCount: z.number().int().min(0),
    eveningCheckinsCount: z.number().int().min(0),
    streakDays: z.number().int().min(0),
    sleepHoursMedian: z.number().min(0).max(24).nullable(),
    moodMedian: z.number().min(1).max(10).nullable(),
    stressMedian: z.number().min(1).max(10).nullable(),
    annotationsReceived: z.number().int().min(0),
    annotationsViewed: z.number().int().min(0),
    douglasCardsDelivered: z.number().int().min(0),
    douglasCardsSeen: z.number().int().min(0),
    douglasCardsHelpful: z.number().int().min(0),
  })
  .strict();

/// Free-text slice — sanitized via safeFreeText before snapshot leaves the
/// builder. ALL strings here MUST pass through safeFreeText (this schema
/// enforces it via .transform). The builder must NOT bypass this for any
/// member-controlled text (journalNote, intention, sportType, gratitudes).
const freeTextSliceSchema = z
  .object({
    /// Top emotion tags observed this week (deduped, frequency-sorted).
    emotionTags: z.array(z.string().trim().min(1).max(40)).max(20),
    /// Top trading pairs traded this week (frequency-sorted).
    pairsTraded: z.array(z.string().trim().min(1).max(20)).max(10),
    /// Sessions traded (asia / london / overlap / newyork) with counts.
    sessionsTraded: z
      .array(
        z.object({
          session: z.enum(['asia', 'london', 'newyork', 'overlap']),
          count: z.number().int().min(0),
        }),
      )
      .max(4),
    /// Sample of journal note excerpts — already safeFreeText-sanitized.
    journalExcerpts: z.array(safePatternValueSchema).max(5),
  })
  .strict();

export const weeklySnapshotSchema = z
  .object({
    userId: z.string().min(1).max(64),
    timezone: z.string().min(3).max(60),
    weekStart: z.date(),
    weekEnd: z.date(),
    counters: counterSliceSchema,
    freeText: freeTextSliceSchema,
    /// Behavioral score snapshot from `lib/scoring`. Null = `insufficient_data`.
    scores: z
      .object({
        discipline: z.number().int().min(0).max(100).nullable(),
        emotionalStability: z.number().int().min(0).max(100).nullable(),
        consistency: z.number().int().min(0).max(100).nullable(),
        engagement: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
  })
  .strict();

export type WeeklySnapshot = z.infer<typeof weeklySnapshotSchema>;
