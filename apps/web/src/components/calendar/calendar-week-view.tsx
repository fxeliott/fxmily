import type { CalendarSlotValue } from '@/lib/calendar/instrument-v1';
import {
  CALENDAR_OUTPUT_SLOTS,
  type CalendarBlockCategoryValue,
  type CalendarDay,
} from '@/lib/schemas/adaptive-calendar';
import { C } from '@/lib/theme-colors';
import { cn } from '@/lib/utils';

/**
 * §26 Calendrier adaptatif — the 7-day color-coded week grid (J-C4).
 *
 * THE shared read-only reader (member `/calendrier` + admin
 * `?tab=calendar`) — one presentational surface, single a11y/posture audit.
 *
 * Mobile-first (375): a vertical stack of day cards. Desktop: a 2-up grid
 * (`sm:grid-cols-2`) — never a 7-narrow-column strip (block chips carry rich
 * FR text + would be cramped). The page stays `max-w-3xl` (carbone
 * `/debrief-mensuel`).
 *
 * Posture (anti-Black-Hat Yu-kai Chou + §2):
 *   - The ONLY signal is each block's `priority` (visual weight: bar thickness
 *     + opacity), NEVER a red "pas fait", NEVER a streak/score/timer.
 *   - Category colours are HEX from `@/lib/theme-colors` (`C.*`), NEVER
 *     `var(--token)` — inline-style colours must resolve in iOS WebView
 *     (J6.6 BLOCKER B1). RED (`C.bad`) is never used for a category.
 *   - WCAG 1.4.1 (Use of Color): the colour is decorative reinforcement; the
 *     category is ALWAYS conveyed as TEXT in the chip caption.
 */

/** Category → calm hex colour + FR label. No RED (anti-Black-Hat). */
const CATEGORY_META: Record<CalendarBlockCategoryValue, { label: string; color: string }> = {
  live_trading: { label: 'Session live', color: C.acc }, // blue — core practice
  backtest: { label: 'Entraînement', color: C.cy }, // cyan — §21.7 training identity
  mark_douglas_review: { label: 'Mark Douglas', color: C.ok }, // green — psychology / growth
  // meeting/checkin/rest/free are NEUTRAL on purpose: AMBER is reserved for the
  // warnings rail, so a meeting block never reads as a "caution" (avoids the
  // meeting↔warning amber collision, ui audit T2). The category is ALWAYS
  // conveyed as TEXT in the caption — the colour is decorative reinforcement.
  meeting: { label: 'Réunion', color: C.t2 }, // neutral light — §30 commitment
  checkin: { label: 'Check-in', color: C.t3 }, // neutral — daily routine
  rest: { label: 'Repos', color: C.t4 }, // neutral muted — calm by design
  free: { label: 'Temps libre', color: C.t4 }, // neutral muted — unscheduled
};

const SLOT_LABELS: Record<CalendarSlotValue, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
};

/** Canonical slot order (morning → afternoon → evening). */
const SLOT_ORDER = new Map<CalendarSlotValue, number>(
  CALENDAR_OUTPUT_SLOTS.map((slot, index) => [slot, index]),
);

const FMT_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC', // civil dates (YYYY-MM-DD) — never shift by a runtime TZ.
});

/** "8 juin" from a YYYY-MM-DD civil date (UTC math, no TZ drift). */
function formatDayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return FMT_DAY.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Calm neutral shown if a persisted block carries an out-of-enum category. */
const FALLBACK_CATEGORY = { label: 'Bloc', color: C.t3 } as const;

/**
 * Defensive category lookup. The persisted `schedule` is cast from a JSONB
 * column (`service.serializeCalendar`), so a legacy/drifted row — e.g. after a
 * future instrument-v2 enum change — could carry a category outside the current
 * 7 values despite the compile-time type. Fall back to a calm neutral instead of
 * crashing the whole page (mirrors the `SLOT_ORDER.get(...) ?? 0` guard below).
 */
function categoryMetaFor(category: string): { label: string; color: string } {
  return (
    (CATEGORY_META as Record<string, { label: string; color: string }>)[category] ??
    FALLBACK_CATEGORY
  );
}

/** Defensive slot label lookup (same JSONB-drift rationale). */
function slotLabelFor(slot: string): string {
  return (SLOT_LABELS as Record<string, string>)[slot] ?? slot;
}

function DayCard({ day }: { day: CalendarDay }) {
  const blocks = [...day.blocks].sort(
    (a, b) => (SLOT_ORDER.get(a.slot) ?? 0) - (SLOT_ORDER.get(b.slot) ?? 0),
  );

  return (
    <div className="rounded-card flex h-full flex-col border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-[var(--t-1)]">{day.dayLabel}</span>
        <span className="t-cap text-[var(--t-3)] tabular-nums">{formatDayDate(day.date)}</span>
      </div>

      {blocks.length === 0 ? (
        <p className="t-cap text-[var(--t-3)]">Journée libre — aucun bloc planifié.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocks.map((block, idx) => {
            const meta = categoryMetaFor(block.category);
            return (
              <li
                key={`${block.slot}-${idx}`}
                className={cn(
                  'rounded-control flex items-stretch gap-2.5 border border-[var(--b-default)] bg-[var(--bg-2)] p-2.5',
                  block.priority === 'low' && 'opacity-70',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'shrink-0 self-stretch rounded-full',
                    block.priority === 'high' ? 'w-1.5' : 'w-1',
                  )}
                  style={{ backgroundColor: meta.color }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="t-cap text-[var(--t-3)]">
                    {meta.label} · {slotLabelFor(block.slot)} · {block.durationMin} min
                  </span>
                  <span className="text-[13px] leading-snug text-[var(--t-1)]">
                    {block.label}
                    {/* priority = visual weight; give SR a text equivalent so the
                        signal is not colour/opacity-only (WCAG 1.4.1). medium =
                        no marker (the neutral default). */}
                    {block.priority === 'high' ? (
                      <span className="sr-only"> (temps fort)</span>
                    ) : block.priority === 'low' ? (
                      <span className="sr-only"> (secondaire)</span>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function CalendarWeekView({ days }: { days: readonly CalendarDay[] }) {
  return (
    <section data-slot="calendar-week-view" aria-label="Planning de la semaine">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {days.map((day) => (
          <li key={day.date}>
            <DayCard day={day} />
          </li>
        ))}
      </ul>
    </section>
  );
}
