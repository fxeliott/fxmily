import { parseLocalDate } from '@/lib/checkin/timezone';
import type { HeatLevel, YearHeatmap } from '@/lib/checkin/year-heatmap';
import { cn } from '@/lib/utils';

/**
 * DisciplineYearHeatmap (S11) — GitHub-contributions style calendar of daily
 * check-in regularity over the last 53 weeks.
 *
 * A11y (WCAG 2.2 AA): the grid carries `role="img"` + a single descriptive
 * `aria-label` summary (a 371-cell read-out would be hostile to SR users — the
 * overview IS the information). Cells are `aria-hidden` decorative squares with a
 * native `title` for sighted hover detail (date + count), so there's no
 * double-announce (the precedent set by habit-heatmap.tsx). `forced-colors`
 * fallback keeps active/empty distinct in Windows High Contrast. No animation →
 * prefers-reduced-motion satisfied by construction.
 *
 * Anti-Black-Hat (§31.2): empty days are muted slate, NEVER red. This is a calm
 * mirror of constancy — no streak pressure, no shame, no scoreboard.
 */

const CELL = 11; // px
const GAP = 3; // px

const FULL_DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const WEEKDAY_LABELS = ['Lun', '', 'Mer', '', 'Ven', '', '']; // Mon-first; Mon/Wed/Fri only (GitHub-style)

function cellClass(level: HeatLevel): string {
  if (level === 0) {
    return 'border-[var(--b-strong)] bg-[var(--bg-3)] forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]';
  }
  if (level === 1) {
    return 'border-[var(--b-acc)] bg-[var(--acc-dim)] forced-colors:bg-[Highlight]';
  }
  return 'border-[var(--b-acc)] bg-[var(--acc)] forced-colors:bg-[Highlight]';
}

function titleFor(date: string, level: HeatLevel): string {
  const day = FULL_DAY_FMT.format(parseLocalDate(date));
  const what = level === 0 ? 'aucun check-in' : level === 1 ? '1 check-in' : '2 check-ins';
  return `${day} — ${what}`;
}

export function DisciplineYearHeatmap({ heatmap }: { heatmap: YearHeatmap }) {
  const { weeks, activeDays, monthLabels } = heatmap;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="t-mono-cap text-[var(--t-4)]">Régularité — 12 derniers mois</span>
        <span className="t-cap text-[var(--t-3)]">
          <span className="f-mono text-[var(--t-2)] tabular-nums">{activeDays}</span> jours actifs
        </span>
      </figcaption>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          {/* Month axis (decorative — per-cell title + the grid summary carry it for SR). */}
          <div
            aria-hidden
            className="grid text-[10px] text-[var(--t-4)]"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, ${CELL}px)`, gap: `${GAP}px` }}
          >
            {monthLabels.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                className="whitespace-nowrap"
                style={{ gridColumnStart: m.col + 1 }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            {/* Weekday rail (Mon/Wed/Fri). */}
            <div
              aria-hidden
              className="grid text-[10px] text-[var(--t-4)]"
              style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gap: `${GAP}px` }}
            >
              {WEEKDAY_LABELS.map((w, i) => (
                <span key={i} className="flex items-center leading-none">
                  {w}
                </span>
              ))}
            </div>

            {/* The calendar grid — column-first (one column per week). */}
            <div
              role="img"
              aria-label={`Calendrier de régularité des check-ins sur les 12 derniers mois : ${activeDays} jours avec au moins un check-in.`}
              className="grid"
              style={{
                gridTemplateRows: `repeat(7, ${CELL}px)`,
                gridAutoColumns: `${CELL}px`,
                gridAutoFlow: 'column',
                gap: `${GAP}px`,
              }}
            >
              {weeks.flatMap((col, c) =>
                col.map((cell, r) =>
                  cell ? (
                    <span
                      key={`${c}-${r}`}
                      aria-hidden
                      title={titleFor(cell.date, cell.level)}
                      className={cn(
                        'rounded-[3px] border transition-transform hover:scale-125',
                        cellClass(cell.level),
                      )}
                    />
                  ) : (
                    <span key={`${c}-${r}`} aria-hidden className="rounded-[3px]" />
                  ),
                ),
              )}
            </div>
          </div>

          {/* Legend. */}
          <div className="mt-1 flex items-center gap-1.5 self-end" aria-hidden>
            <span className="t-mono-cap text-[var(--t-4)]">Moins</span>
            {([0, 1, 2] as HeatLevel[]).map((l) => (
              <span key={l} className={cn('size-[11px] rounded-[3px] border', cellClass(l))} />
            ))}
            <span className="t-mono-cap text-[var(--t-4)]">Plus</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
