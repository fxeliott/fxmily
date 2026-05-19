import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';

/**
 * V1.5 — current mindset-check week anchor (SPEC §27.7).
 *
 * Returns the Monday (`YYYY-MM-DD`) of the Europe/Paris civil week containing
 * "now". Shared by `/mindset` (landing CTA + "already submitted?" check) and
 * `/mindset/new` (instrument host + wizard hidden input) so the two pages can
 * NEVER disagree on "this week" across a midnight boundary.
 *
 * §27.7 invariant (PR#96 nocturnal flake, carbon of `training-debrief/week.ts`
 * §23.7): the anchor goes through `localDateOf(..., 'Europe/Paris')` +
 * `parseLocalDate` + Monday math — NEVER `new Date().toISOString().slice(0,
 * 10)` nor `getUTCDay()` on a naive instant. Europe/Paris is the V1 cohort
 * timezone (all members FR); a multi-tz V2 would thread `User.timezone` here.
 * Pure (no DB, deterministic given the clock).
 */
export function currentParisWeekStart(now: Date = new Date()): string {
  const todayParis = localDateOf(now, 'Europe/Paris');
  // parseLocalDate → UTC-midnight Date; getUTCDay 0=Sun..6=Sat (deterministic
  // on an explicit UTC-midnight value, not a naive parse).
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
}

// Display-only, UTC-pinned (the `YYYY-MM-DD` parts are built into a UTC Date
// then formatted in UTC — no tz drift on the human label).
const FMT_DAY_FR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/**
 * Human FR label for the mindset week, e.g. "11 mai → 17 mai". `weekStart`
 * is a `YYYY-MM-DD` Monday; the end is `weekStart + 6 j` (service SSOT,
 * SPEC §27.3 — never received from / sent to the client).
 */
export function formatWeekRangeFr(weekStart: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return FMT_DAY_FR.format(new Date(Date.UTC(y, m - 1, d)));
  };
  const probe = parseLocalDate(weekStart);
  probe.setUTCDate(probe.getUTCDate() + 6);
  const weekEnd = probe.toISOString().slice(0, 10);
  return `${fmt(weekStart)} → ${fmt(weekEnd)}`;
}

/**
 * `weekEnd` = `weekStart + 6 j`, service-side single source of truth
 * (SPEC §27.3 anti-tamper — the client never sends nor receives it as input).
 */
export function weekEndFromWeekStart(weekStart: string): string {
  const probe = parseLocalDate(weekStart);
  probe.setUTCDate(probe.getUTCDate() + 6);
  return probe.toISOString().slice(0, 10);
}
