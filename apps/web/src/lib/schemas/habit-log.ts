import { z } from 'zod';

/**
 * V2.0 TRACK module — Zod schemas for `HabitLog` input validation.
 *
 * The DB schema (`prisma/schema.prisma`) stores habit logs with a kind-specific
 * structured `value` JSON column. This module is the canonical mapping between
 * the `HabitKind` enum and the shape of `value` for that kind — so a `sleep`
 * row's `value` is always `{ durationMin, quality? }`, a `caffeine` row's
 * `value` is always `{ cups, lastDrinkAtUtc? }`, etc.
 *
 * Design choices :
 *   - Discriminated union on `kind` for compile-time exhaustiveness checks.
 *   - All ratings 1-10 (consistent with the J5 check-in scale — no separate
 *     1-5 or 0-100 surface for members to learn).
 *   - Durations in **minutes** (avoids JS float drift on hours-as-float).
 *   - `date` is `YYYY-MM-DD` (local civil date) — server re-parses to UTC
 *     midnight via `parseLocalDate` (same pattern as DailyCheckin / WeeklyReview).
 *   - Backfill window `[-14d, +1d]` mirrors the existing reflection rule —
 *     wide enough for honest weekend backfill, tight enough to block someone
 *     replaying a year's worth of fake data.
 */

// =============================================================================
// Constants
// =============================================================================

export const HABIT_NOTES_MAX_CHARS = 500;
export const HABIT_BACKFILL_WINDOW_DAYS = 14;
export const HABIT_FORWARD_WINDOW_DAYS = 1;

// =============================================================================
// Kind enum (mirrors `enum HabitKind` in schema.prisma)
// =============================================================================

export const habitKindSchema = z.enum(['sleep', 'nutrition', 'caffeine', 'sport', 'meditation']);
export type HabitKind = z.infer<typeof habitKindSchema>;

// =============================================================================
// Per-kind value shapes
// =============================================================================

/** Sleep — duration in minutes (0–24h) + optional 1–10 quality. */
export const sleepValueSchema = z
  .object({
    durationMin: z.number().int().min(0).max(1440),
    quality: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type SleepValue = z.infer<typeof sleepValueSchema>;

/** Nutrition — meals count + optional qualitative tag. */
export const nutritionQualitySchema = z.enum(['poor', 'fair', 'good', 'excellent']);
export const nutritionValueSchema = z
  .object({
    mealsCount: z.number().int().min(0).max(10),
    quality: nutritionQualitySchema.optional(),
  })
  .strict();
export type NutritionValue = z.infer<typeof nutritionValueSchema>;

/** Caffeine — cups + optional last-drink time as HH:MM UTC. */
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const caffeineValueSchema = z
  .object({
    cups: z.number().int().min(0).max(20),
    lastDrinkAtUtc: z.string().regex(HHMM, 'Format HH:MM attendu.').optional(),
  })
  .strict();
export type CaffeineValue = z.infer<typeof caffeineValueSchema>;

/** Sport — kind/duration/intensity. */
export const sportKindSchema = z.enum(['cardio', 'strength', 'mixed', 'flexibility', 'other']);
export const sportValueSchema = z
  .object({
    type: sportKindSchema,
    durationMin: z.number().int().min(0).max(600),
    intensityRating: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type SportValue = z.infer<typeof sportValueSchema>;

/** Meditation — duration + optional quality rating. */
export const meditationValueSchema = z
  .object({
    durationMin: z.number().int().min(0).max(180),
    quality: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type MeditationValue = z.infer<typeof meditationValueSchema>;

// =============================================================================
// Date window helpers
// =============================================================================

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD attendu.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Date invalide.');

/**
 * Refine a candidate date string against the `[-windowDays, +forwardDays]`
 * window measured from `now` (UTC midnight anchor). Mirrors the rule used by
 * reflection / weekly-review schemas.
 */
function dateInWindow(value: string, now: Date = new Date()): boolean {
  const dt = new Date(`${value}T00:00:00Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const minTs = today.getTime() - HABIT_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const maxTs = today.getTime() + HABIT_FORWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const ts = dt.getTime();
  return ts >= minTs && ts <= maxTs;
}

// =============================================================================
// Discriminated input schema (the one Server Actions / route handlers consume)
// =============================================================================

const notesField = z
  .string()
  .max(HABIT_NOTES_MAX_CHARS, `${HABIT_NOTES_MAX_CHARS} caractères max.`)
  .optional();

const dateField = isoDate.refine((v) => dateInWindow(v), {
  message: `Date hors fenêtre autorisée (${HABIT_BACKFILL_WINDOW_DAYS}j en arrière → ${HABIT_FORWARD_WINDOW_DAYS}j en avant).`,
});

export const habitLogInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('sleep'),
      date: dateField,
      value: sleepValueSchema,
      notes: notesField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('nutrition'),
      date: dateField,
      value: nutritionValueSchema,
      notes: notesField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('caffeine'),
      date: dateField,
      value: caffeineValueSchema,
      notes: notesField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('sport'),
      date: dateField,
      value: sportValueSchema,
      notes: notesField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('meditation'),
      date: dateField,
      value: meditationValueSchema,
      notes: notesField,
    })
    .strict(),
]);
export type HabitLogInput = z.infer<typeof habitLogInputSchema>;
