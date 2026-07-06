/**
 * Shared French label for an off-day civil date (Tour 15). One formatter used
 * by BOTH the `/account/rythme` Server Component (initial list) and the
 * `declareOffDayRangeAction` return value (optimistic list update), so the rows
 * a member sees appear right after submitting are byte-identical to the ones
 * the next SSR pass renders.
 *
 * The `@db.Date` column is UTC-midnight-pinned: `timeZone: 'UTC'` keeps the
 * label on the stored calendar day (no member-timezone shift — the pinned date
 * IS the civil day).
 */
const dateLabelFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** "mardi 7 juillet" for a UTC-midnight-pinned civil date. */
export function formatOffDayLabel(date: Date): string {
  return dateLabelFmt.format(date);
}
