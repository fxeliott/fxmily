import { parseLocalDate, shiftLocalDate, type LocalDateString } from './timezone';

/**
 * Pure builder for the year "régularité" heatmap (S11) — a GitHub-contributions
 * style calendar of daily check-in activity over the last 53 weeks.
 *
 * Level is the number of check-in slots filed that day (0 / 1 / 2) — a faithful,
 * single-source mirror of practice regularity. Anti-Black-Hat (§31.2): an empty
 * day is a muted absence, NEVER a red "missed" — this is a calm mirror of
 * constancy, not a scoreboard or a shame grid.
 *
 * Layout matches GitHub: 53 week-columns × 7 weekday-rows (Monday-first, FR).
 * Cells past `today` (the trailing partial week) are `null` placeholders.
 */
export type HeatLevel = 0 | 1 | 2;

export interface HeatCell {
  date: LocalDateString;
  level: HeatLevel;
}

export interface YearHeatmap {
  /** Columns (oldest → newest). Each column is 7 cells, Mon..Sun; null = out of range. */
  weeks: (HeatCell | null)[][];
  /** Days with ≥1 check-in across the visible range. */
  activeDays: number;
  /** Month tick labels for the top axis: { col, label }. */
  monthLabels: { col: number; label: string }[];
}

const WEEKS = 53;

/**
 * Minimum column gap between two month labels before they overlap. A label
 * renders ~20-25px wide at 10px font while a column pitch is 14px (11px cell
 * + 3px gap), so two labels 1-2 columns apart draw on top of each other.
 * Real month starts are always ≥ 4 columns apart — only the leading partial
 * month segment can sit closer than this to its successor.
 */
const MONTH_LABEL_MIN_COL_GAP = 3;

export const MONTHS_FR = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;

/** Monday = 0 … Sunday = 6 (FR week start). */
function weekdayMonFirst(date: LocalDateString): number {
  return (parseLocalDate(date).getUTCDay() + 6) % 7;
}

export function buildYearHeatmap(
  levelByDate: ReadonlyMap<LocalDateString, HeatLevel>,
  today: LocalDateString,
): YearHeatmap {
  const lastMonday = shiftLocalDate(today, -weekdayMonFirst(today));
  const firstMonday = shiftLocalDate(lastMonday, -(WEEKS - 1) * 7);

  const weeks: (HeatCell | null)[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let activeDays = 0;
  let lastMonth = -1;

  for (let c = 0; c < WEEKS; c++) {
    const colMonday = shiftLocalDate(firstMonday, c * 7);
    const col: (HeatCell | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const d = shiftLocalDate(colMonday, r);
      if (d > today) {
        col.push(null);
        continue;
      }
      const level = levelByDate.get(d) ?? 0;
      if (level > 0) activeDays += 1;
      col.push({ date: d, level });
    }
    const firstCell = col.find((x): x is HeatCell => x != null);
    if (firstCell) {
      const m = parseLocalDate(firstCell.date).getUTCMonth();
      if (m !== lastMonth) {
        monthLabels.push({ col: c, label: MONTHS_FR[m]! });
        lastMonth = m;
      }
    }
    weeks.push(col);
  }

  // Anti-overlap guard (prod audit 2026-07-02, « juiljuil. » on /progression):
  // the leading month segment can be as narrow as one column, which puts its
  // label right under the next month's — the two render superposed. Only the
  // first pair can ever collide (see MONTH_LABEL_MIN_COL_GAP), so dropping the
  // partial leading label is the complete fix and never hides a real month.
  if (
    monthLabels.length >= 2 &&
    monthLabels[1]!.col - monthLabels[0]!.col < MONTH_LABEL_MIN_COL_GAP
  ) {
    monthLabels.shift();
  }

  return { weeks, activeDays, monthLabels };
}
