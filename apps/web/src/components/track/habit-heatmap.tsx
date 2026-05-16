import type { HabitHeatmapDay } from '@/lib/analytics/habit-trade-correlation';
import { parseLocalDate } from '@/lib/checkin/timezone';
import type { HabitKind } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

/**
 * 7-day habit heatmap (GitHub-contributions style) — V2.1.3.
 *
 * Server Component, **plain semantic `<table>`**, not Recharts. Rationale
 * (web research 2026 + a11y): Recharts has no native heatmap (issue #237)
 * and an SVG grid can't carry the row/column header semantics WCAG 1.3.1
 * needs. A table gives full keyboard/SR control for free.
 *
 * Accessibility (WCAG 2.2 AA):
 *   - Not color-only (SC 1.4.1): every cell's state is in its
 *     `aria-label` + the row/column `<th>` headers, not just the fill.
 *     (No `title` — it duplicated the aria-label and double-announced on
 *     35 cells; a11y review V2.1.3 T2.)
 *   - Empty cells keep a visible 1px `--b-strong` border (SC 1.4.11) so
 *     the grid edge is perceivable on the dark background.
 *   - `forced-colors` fallback so the logged/empty distinction survives
 *     Windows High Contrast (a known unfixed gap on GitHub's own chart).
 *   - No animation at all → `prefers-reduced-motion` is satisfied by
 *     construction.
 *   - `overflow-x-auto` wrapper: on a 320–375px viewport the worst-case
 *     label ("Méditation") + 7 cells can graze the edge; the grid
 *     scrolls instead of breaking the whole card layout.
 *
 * Anti-dark-pattern (Mark Douglas / Yu-kai Chou): a missing day is muted
 * slate, never red. No streak counter, no shame — the grid is a calm
 * mirror of practice, not a scoreboard.
 */

const KIND_ORDER: readonly HabitKind[] = ['sleep', 'nutrition', 'caffeine', 'sport', 'meditation'];

const KIND_LABEL_FR: Record<HabitKind, string> = {
  sleep: 'Sommeil',
  nutrition: 'Nutrition',
  caffeine: 'Café',
  sport: 'Sport',
  meditation: 'Méditation',
};

// Hoisted at module scope (V1.9 TIER F perf pattern — avoid per-row
// `Intl.DateTimeFormat` instantiation).
const SHORT_DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const FULL_DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

function shortDay(date: string): string {
  return SHORT_DAY_FMT.format(parseLocalDate(date));
}
function fullDay(date: string): string {
  return FULL_DAY_FMT.format(parseLocalDate(date));
}

interface HabitHeatmapProps {
  /** Newest-first (the analytics layer guarantees this). Rendered oldest
   *  → newest left-to-right, so we reverse for display. */
  days: readonly HabitHeatmapDay[];
}

export function HabitHeatmap({ days }: HabitHeatmapProps) {
  // Oldest → newest for natural left-to-right reading.
  const cols = [...days].reverse();

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="t-mono-cap text-[var(--t-4)]">
        Régularité — {cols.length} derniers jours
      </figcaption>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-left">
          <caption className="sr-only">
            Habitudes loggées sur les {cols.length} derniers jours, par pilier et par jour.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Pilier
              </th>
              {cols.map((d) => (
                <th
                  key={d.date}
                  scope="col"
                  className="t-mono-cap pb-1 text-center text-[10px] font-normal whitespace-nowrap text-[var(--t-3)]"
                >
                  {shortDay(d.date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KIND_ORDER.map((kind) => (
              <tr key={kind}>
                <th
                  scope="row"
                  className="t-mono-cap pr-2 text-[11px] font-normal whitespace-nowrap text-[var(--t-3)]"
                >
                  {KIND_LABEL_FR[kind]}
                </th>
                {cols.map((d) => {
                  const logged = d.kinds[kind] === true;
                  return (
                    <td key={d.date} className="p-0 text-center">
                      <span
                        aria-label={`${KIND_LABEL_FR[kind]}, ${fullDay(d.date)} : ${
                          logged ? 'loggé' : 'non loggé'
                        }`}
                        className={cn(
                          'inline-block h-4 w-4 rounded-[4px] border align-middle',
                          logged
                            ? 'border-[var(--b-acc)] bg-[var(--acc)] forced-colors:bg-[Highlight]'
                            : 'border-[var(--b-strong)] bg-[var(--bg-3)] forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
