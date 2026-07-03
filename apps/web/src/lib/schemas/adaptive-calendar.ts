/**
 * §26 Calendrier adaptatif — Zod schema for the Claude OUTPUT (the generated
 * weekly plan, J-C1). Carbone `weeklyReportOutputSchema`.
 *
 * Validated TWICE (defense-in-depth): the batch pipeline (J-C2) asks Claude for
 * this exact JSON shape, then re-parses the response with `.strict()` here so a
 * hallucinated/extra key is rejected. Every free-text field is passed through
 * `safeFreeText` (NFC + bidi/zero-width strip) even though it is AI output — a
 * Trojan-Source RTL override in the model's text must never reach the member's
 * screen or a downstream prompt.
 *
 * Posture §2 (BLOQUANT): this plan organises TIME (sessions / backtest / Mark
 * Douglas / réunions §30 / rest), NEVER a market call. The block `category`
 * vocabulary mirrors the Postgres `CalendarBlockCategory` enum; the `slot`
 * vocabulary mirrors `CalendarSlot` (lib/calendar/instrument-v1.ts).
 */

import { z } from 'zod';

import { CALENDAR_SLOTS, type CalendarSlotValue } from '@/lib/calendar/instrument-v1';
import { normalizeAiTypography } from '@/lib/text/normalize-typography';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

// =============================================================================
// Closed vocabularies (mirror the Postgres enums)
// =============================================================================

/** Mirrors the Postgres `CalendarBlockCategory` enum (schema.prisma). */
export const CALENDAR_BLOCK_CATEGORIES = [
  'live_trading',
  'backtest',
  'mark_douglas_review',
  'checkin',
  'rest',
  'meeting',
  'free',
] as const;
export type CalendarBlockCategoryValue = (typeof CALENDAR_BLOCK_CATEGORIES)[number];

export const CALENDAR_BLOCK_PRIORITIES = ['high', 'medium', 'low'] as const;
export type CalendarBlockPriority = (typeof CALENDAR_BLOCK_PRIORITIES)[number];

// Bounds — calm, member-facing copy. Tight enough to reject a runaway model.
const OVERVIEW_MIN = 100;
const OVERVIEW_MAX = 300;
const WEEKLY_FOCUS_MIN = 50;
const WEEKLY_FOCUS_MAX = 200;
const LABEL_MAX = 60;
const DAY_LABEL_MAX = 40;
const WARNING_MAX = 200;
const BLOCK_DURATION_MIN = 15;
const BLOCK_DURATION_MAX = 120;
const MAX_BLOCKS_PER_DAY = 8;
const MAX_WARNINGS = 3;

function safeText(min: number, max: number) {
  return (
    z
      .string()
      .trim()
      .min(min)
      .max(max)
      .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
      .transform(safeFreeText)
      // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
      .transform(normalizeAiTypography)
  );
}

const localDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

// =============================================================================
// Schema
// =============================================================================

export const calendarBlockSchema = z
  .object({
    slot: z.enum(CALENDAR_SLOTS),
    category: z.enum(CALENDAR_BLOCK_CATEGORIES),
    durationMin: z.number().int().min(BLOCK_DURATION_MIN).max(BLOCK_DURATION_MAX),
    label: safeText(1, LABEL_MAX),
    priority: z.enum(CALENDAR_BLOCK_PRIORITIES),
  })
  .strict();

export type CalendarBlock = z.infer<typeof calendarBlockSchema>;

export const calendarDaySchema = z
  .object({
    date: localDateString,
    dayLabel: safeText(1, DAY_LABEL_MAX),
    blocks: z.array(calendarBlockSchema).max(MAX_BLOCKS_PER_DAY),
  })
  .strict();

export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const adaptiveCalendarOutputSchema = z
  .object({
    weekStart: localDateString,
    overview: safeText(OVERVIEW_MIN, OVERVIEW_MAX),
    days: z.array(calendarDaySchema).length(7),
    weeklyFocus: safeText(WEEKLY_FOCUS_MIN, WEEKLY_FOCUS_MAX),
    warnings: z.array(safeText(1, WARNING_MAX)).max(MAX_WARNINGS),
  })
  .strict();

export type AdaptiveCalendarOutput = z.infer<typeof adaptiveCalendarOutputSchema>;

/**
 * Pure helper — the dominant block `category` of a validated calendar, used to
 * denormalise `AdaptiveCalendar.primary_category` at persist time (admin
 * week-at-a-glance). Counts every block across the 7 days; ties broken by the
 * `CALENDAR_BLOCK_CATEGORIES` declaration order (deterministic). Returns `null`
 * for an empty schedule (no blocks at all).
 */
export function deriveDominantBlockCategory(
  output: AdaptiveCalendarOutput,
): CalendarBlockCategoryValue | null {
  const counts = new Map<CalendarBlockCategoryValue, number>();
  for (const day of output.days) {
    for (const block of day.blocks) {
      counts.set(block.category, (counts.get(block.category) ?? 0) + 1);
    }
  }
  let best: CalendarBlockCategoryValue | null = null;
  let bestCount = 0;
  for (const category of CALENDAR_BLOCK_CATEGORIES) {
    const n = counts.get(category) ?? 0;
    if (n > bestCount) {
      best = category;
      bestCount = n;
    }
  }
  return best;
}

/** Re-export so callers can iterate the canonical slot order without a 2nd import. */
export const CALENDAR_OUTPUT_SLOTS: readonly CalendarSlotValue[] = CALENDAR_SLOTS;
