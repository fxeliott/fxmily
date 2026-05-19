/**
 * Pure FR display formatters for the V1.4 monthly debrief (SPEC §25).
 *
 * NOT `server-only` and zero I/O — safe to import from Server Components,
 * the React Email template, and the admin panel alike (anti-dup: one
 * formatter, three call-sites, mirror `training-debrief/week.ts`).
 *
 * Inputs are the serialized `YYYY-MM-DD` strings produced by
 * `monthly-debrief/service.ts` (`monthStart` = local 1st-of-month). The
 * member mental model is "mon bilan de mai" (SPEC §25.2), so the label is
 * the civil month + year, not a day range.
 */

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/**
 * `"2026-05-01"` → `"Mai 2026"` (capitalised, member-facing).
 * Defensive on a malformed string (returns the raw input) so a hand-edited
 * row never throws in the page render.
 */
export function formatMonthLabelFr(monthStartIso: string): string {
  const [y, m] = monthStartIso.split('-');
  const monthIdx = Number(m) - 1;
  const name = MONTHS_FR[monthIdx];
  if (name === undefined || y === undefined || y.length !== 4) return monthStartIso;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/**
 * `"2026-05-01"` → `"mai 2026"` (lowercase, for mid-sentence use such as
 * "Ton débrief de mai 2026").
 */
export function formatMonthInlineFr(monthStartIso: string): string {
  const [y, m] = monthStartIso.split('-');
  const monthIdx = Number(m) - 1;
  const name = MONTHS_FR[monthIdx];
  if (name === undefined || y === undefined || y.length !== 4) return monthStartIso;
  return `${name} ${y}`;
}
