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

  return { weeks, activeDays, monthLabels };
}
