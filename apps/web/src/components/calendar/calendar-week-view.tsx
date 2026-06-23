import {
  Activity,
  CheckCircle2,
  type LucideIcon,
  Minus,
  Moon,
  Repeat,
  Target,
  Users,
} from 'lucide-react';

import { categoryMetaFor, slotLabelFor, slotOrderIndex } from '@/components/calendar/calendar-meta';
import { type CalendarDay } from '@/lib/schemas/adaptive-calendar';
import { cn } from '@/lib/utils';

/**
 * Category → lucide micro-icon (J-S20 visuals fix). The four neutral categories
 * (réunion / check-in / repos / temps libre) share the same `--t-*` rail tint
 * and were near-indistinguishable; a glyph at the head of each chip carries the
 * signal WITHOUT introducing a second colour (mono-accent intact — the bar +
 * the icon are both decorative reinforcement, the category stays TEXT in the
 * caption, WCAG 1.4.1). Defensive lookup mirrors `categoryMetaFor` (JSONB drift).
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  live_trading: Activity, // pulse — core practice
  backtest: Repeat, // training rep loop (§21.7)
  mark_douglas_review: Target, // psychology focus
  meeting: Users, // §30 commitment
  checkin: CheckCircle2, // daily routine
  rest: Moon, // calm by design
  free: Minus, // unscheduled
};

function categoryIconFor(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Minus;
}

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
 *   - Category colours + labels come from the shared `calendar-meta` SSOT
 *     (HEX `C.*`, never `var(--token)` — iOS WebView, J6.6 BLOCKER B1).
 *   - WCAG 1.4.1 (Use of Color): the colour is decorative reinforcement; the
 *     category is ALWAYS conveyed as TEXT in the chip caption.
 */

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

function DayCard({ day }: { day: CalendarDay }) {
  const blocks = [...day.blocks].sort((a, b) => slotOrderIndex(a.slot) - slotOrderIndex(b.slot));

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
            const CategoryIcon = categoryIconFor(block.category);
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
                  <span className="t-cap inline-flex items-center gap-1.5 text-[var(--t-3)]">
                    <CategoryIcon
                      className="h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
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
