import type { CalendarSlotValue } from '@/lib/calendar/instrument-v1';
import {
  CALENDAR_OUTPUT_SLOTS,
  type CalendarBlockCategoryValue,
} from '@/lib/schemas/adaptive-calendar';

/**
 * §26 Calendrier adaptatif — shared presentational vocabulary (category → calm
 * hex colour + FR label, slot → FR label, slot ordering).
 *
 * Single source of truth consumed by BOTH the 7-day reader
 * (`calendar-week-view.tsx`, member `/calendrier` + admin `?tab=calendar`) AND
 * the daily-guidance "Ton aujourd'hui" panel (`today-guidance.tsx`). Extracted
 * so the two surfaces can NEVER drift on a category colour/label (anti-doublon).
 *
 * Posture (anti-Black-Hat Yu-kai Chou + §2):
 *   - S20: colour is a `var(--token)` (was a baked DARK hex). These values are
 *     consumed ONLY as an HTML inline `style={{ backgroundColor }}` on a <div>
 *     rail — NOT as an SVG `fill`/`stroke` attribute — so the iOS-WebView
 *     `var()` non-resolution caveat (J6.6 B1, SVG-attr-only) does NOT apply, and
 *     using a token lets the rail FLIP in light mode (the old DARK hex stayed
 *     neon/grey on the white canvas — light-dark parity gap).
 *   - RED (`--bad`) is NEVER a category colour. AMBER stays reserved for the
 *     warnings rail (a meeting block must never read as a "caution").
 *   - WCAG 1.4.1 (Use of Color): colour is decorative reinforcement; the
 *     category is ALWAYS conveyed as TEXT in the caption. Lives under
 *     `components/` (NOT `lib/calendar/**`), so it carries no P&L token and is
 *     outside the §26 anti-leak glob by construction.
 */

/** Category → calm theme token (flips light/dark) + FR label. No RED (anti-Black-Hat). */
export const CALENDAR_CATEGORY_META: Record<
  CalendarBlockCategoryValue,
  { label: string; color: string }
> = {
  live_trading: { label: 'Session live', color: 'var(--acc)' }, // blue — core practice
  backtest: { label: 'Entraînement', color: 'var(--cy)' }, // cyan — §21.7 training identity
  mark_douglas_review: { label: 'Mark Douglas', color: 'var(--ok)' }, // green — psychology / growth
  // meeting/checkin/rest/free are NEUTRAL on purpose: AMBER is reserved for the
  // warnings rail, so a meeting block never reads as a "caution" (avoids the
  // meeting↔warning amber collision, ui audit T2).
  meeting: { label: 'Réunion', color: 'var(--t-2)' }, // neutral — §30 commitment
  checkin: { label: 'Check-in', color: 'var(--t-3)' }, // neutral — daily routine
  rest: { label: 'Repos', color: 'var(--t-4)' }, // neutral muted — calm by design
  free: { label: 'Temps libre', color: 'var(--t-4)' }, // neutral muted — unscheduled
};

export const CALENDAR_SLOT_LABELS: Record<CalendarSlotValue, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
};

/** Canonical slot order (morning → afternoon → evening). */
const SLOT_ORDER = new Map<CalendarSlotValue, number>(
  CALENDAR_OUTPUT_SLOTS.map((slot, index) => [slot, index]),
);

/** Calm neutral shown if a persisted block carries an out-of-enum category. */
export const FALLBACK_CATEGORY = { label: 'Bloc', color: 'var(--t-3)' } as const;

/**
 * Defensive category lookup. The persisted `schedule` is cast from a JSONB
 * column, so a legacy/drifted row — e.g. after a future instrument-v2 enum
 * change — could carry a category outside the current 7 values despite the
 * compile-time type. Fall back to a calm neutral instead of crashing.
 */
export function categoryMetaFor(category: string): { label: string; color: string } {
  return (
    (CALENDAR_CATEGORY_META as Record<string, { label: string; color: string }>)[category] ??
    FALLBACK_CATEGORY
  );
}

/** Defensive slot label lookup (same JSONB-drift rationale). */
export function slotLabelFor(slot: string): string {
  return (CALENDAR_SLOT_LABELS as Record<string, string>)[slot] ?? slot;
}

/** Defensive slot ordering index (unknown slot sinks to 0, same rationale). */
export function slotOrderIndex(slot: string): number {
  return SLOT_ORDER.get(slot as CalendarSlotValue) ?? 0;
}
