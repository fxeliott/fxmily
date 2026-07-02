/**
 * V1.8 REFLECT — week helpers shared by the `/review` pages.
 *
 * `currentWeekStartUTC` mirrors `lastMondayUTC()` in
 * `weekly-review-wizard.tsx` so the pages and the wizard agree on "this
 * week" (BUG-1 canon carbone weekly-review-wizard.tsx: compute in UTC,
 * never local `getDay()` — local time desyncs east of UTC and around DST).
 *
 * Pure + client-safe (no `server-only` import) so it stays unit-testable
 * in the plain node vitest environment.
 */

/** Current ISO week Monday (UTC) as `YYYY-MM-DD`. */
export function currentWeekStartUTC(): string {
  const d = new Date();
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Pick the review covering the given week from a newest-first list, or
 * `null` when the week has no review yet.
 *
 * P2 fix (runtime prod) — the weekly review is one-per-week in UPSERT but
 * `/review/new` never signalled an existing review: the wizard re-opened
 * empty and a second submission silently overwrote the first. This helper
 * is the detection both `/review/new` (prefill + "Reprendre" notice) and
 * `/review` (CTA flip) hang off, mindset-landing parity
 * (`mindset/page.tsx` `currentWeek` → `ctaLabel`).
 */
export function findCurrentWeekReview<T extends { weekStart: string }>(
  reviews: readonly T[],
  weekStart: string,
): T | null {
  return reviews.find((r) => r.weekStart === weekStart) ?? null;
}
