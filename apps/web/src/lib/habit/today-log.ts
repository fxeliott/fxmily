/**
 * V2.1 TRACK — "already logged today" prefill helpers (P3 fix).
 *
 * The 5 pillar wizards (`/track/{sleep,nutrition,caffeine,sport,meditation}/new`)
 * upsert on `(userId, date, kind)`. Before this fix the form re-opened EMPTY
 * even when the day already had a log, so a second submission silently
 * overwrote the member's earlier saisie with no signal.
 *
 * Pattern carbone `/review/new` (PR #463) + `/mindset/new` : the host page
 * detects the existing log, parses its `value` JSON through the kind-specific
 * Zod schema, and hands a typed `prefill` to the wizard so it starts SEEDED —
 * a re-submission becomes an EXPLICIT edit, never a silent overwrite.
 *
 * This module is PURE + client-safe (no `server-only`, no DB import) so it
 * stays unit-testable in the plain node vitest environment. The host page owns
 * the DB read (`listRecentHabitLogs(userId, 1)`) and the member-timezone
 * "today" (`localDateOf`); these helpers only filter + shape.
 */

import type { SerializedHabitLog } from '@/lib/habit/service';
import {
  caffeineValueSchema,
  type HabitKind,
  meditationValueSchema,
  nutritionValueSchema,
  sleepValueSchema,
  sportValueSchema,
} from '@/lib/schemas/habit-log';

// ---------------------------------------------------------------------------
// Today lookup (pure — mirrors findCurrentWeekReview in weekly-review/week.ts)
// ---------------------------------------------------------------------------

/**
 * Pick the member's log for `today` (member-timezone civil date, YYYY-MM-DD)
 * and the given `kind` from a recent-logs list, or `null` when none exists.
 *
 * `listRecentHabitLogs(userId, 1)` is a 1-day rolling window whose lower bound
 * is UTC-coarse; a Paris member just after midnight can therefore still have
 * yesterday's row in the list, so the `date === today` equality is what pins
 * the match to the member's actual civil day (same filter the track page +
 * TodayHabitCards already apply).
 */
export function findTodayHabitLog(
  logs: readonly SerializedHabitLog[],
  today: string,
  kind: HabitKind,
): SerializedHabitLog | null {
  return logs.find((log) => log.date === today && log.kind === kind) ?? null;
}

// ---------------------------------------------------------------------------
// Per-kind prefill shapes (mirror each wizard's editable draft fields)
// ---------------------------------------------------------------------------

export interface SleepHabitPrefill {
  /** Hours as a FR-locale-friendly string (durationMin / 60), e.g. "7,5". */
  sleepHours: string;
  /** 1-10, defaulted to the wizard's neutral 6 when the log omitted it. */
  sleepQuality: number;
  notes: string;
}

export interface NutritionHabitPrefill {
  mealsCount: string;
  quality: 'poor' | 'fair' | 'good' | 'excellent' | '';
  notes: string;
}

export interface CaffeineHabitPrefill {
  cups: string;
  /** HH:MM 24h, or '' when the log omitted it. */
  lastDrinkAt: string;
  notes: string;
}

export interface SportHabitPrefill {
  sportType: 'cardio' | 'strength' | 'mixed' | 'flexibility' | 'other';
  durationMin: string;
  /** 1-10, defaulted to the wizard's neutral 5 when the log omitted it. */
  intensity: number;
  notes: string;
}

export interface MeditationHabitPrefill {
  durationMin: string;
  /** 1-10, defaulted to the wizard's neutral 6 when the log omitted it. */
  quality: number;
  notes: string;
}

// ---------------------------------------------------------------------------
// Value formatting helpers
// ---------------------------------------------------------------------------

/**
 * Minutes -> FR-locale hours string : 450 -> "7,5", 480 -> "8". Mirrors the
 * sleep wizard's `parseLocaleNumber` (comma decimal), integers stay bare.
 */
function minutesToLocaleHours(durationMin: number): string {
  const hours = durationMin / 60;
  if (Number.isInteger(hours)) return String(hours);
  // Trim to at most 2 decimals, drop trailing zeros, comma-separate.
  const rounded = Math.round(hours * 100) / 100;
  return String(rounded).replace('.', ',');
}

/**
 * Build the sleep wizard prefill from an existing log, or `null` when the
 * `value` JSON doesn't match `sleepValueSchema` (defensive — a corrupt / older
 * row must never crash the page; it degrades to the empty form).
 */
export function sleepPrefillFromLog(log: SerializedHabitLog): SleepHabitPrefill | null {
  const parsed = sleepValueSchema.safeParse(log.value);
  if (!parsed.success) return null;
  return {
    sleepHours: minutesToLocaleHours(parsed.data.durationMin),
    sleepQuality: parsed.data.quality ?? 6,
    notes: log.notes ?? '',
  };
}

export function nutritionPrefillFromLog(log: SerializedHabitLog): NutritionHabitPrefill | null {
  const parsed = nutritionValueSchema.safeParse(log.value);
  if (!parsed.success) return null;
  return {
    mealsCount: String(parsed.data.mealsCount),
    quality: parsed.data.quality ?? '',
    notes: log.notes ?? '',
  };
}

export function caffeinePrefillFromLog(log: SerializedHabitLog): CaffeineHabitPrefill | null {
  const parsed = caffeineValueSchema.safeParse(log.value);
  if (!parsed.success) return null;
  return {
    cups: String(parsed.data.cups),
    lastDrinkAt: parsed.data.lastDrinkAtUtc ?? '',
    notes: log.notes ?? '',
  };
}

export function sportPrefillFromLog(log: SerializedHabitLog): SportHabitPrefill | null {
  const parsed = sportValueSchema.safeParse(log.value);
  if (!parsed.success) return null;
  return {
    sportType: parsed.data.type,
    durationMin: String(parsed.data.durationMin),
    intensity: parsed.data.intensityRating ?? 5,
    notes: log.notes ?? '',
  };
}

export function meditationPrefillFromLog(log: SerializedHabitLog): MeditationHabitPrefill | null {
  const parsed = meditationValueSchema.safeParse(log.value);
  if (!parsed.success) return null;
  return {
    durationMin: String(parsed.data.durationMin),
    quality: parsed.data.quality ?? 6,
    notes: log.notes ?? '',
  };
}
