import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';

/**
 * §26 — current calendar week anchor. Carbon of `mindset/week.ts` (§27.7) and
 * `training-debrief/week.ts` (§23.7).
 *
 * Returns the Monday (`YYYY-MM-DD`) of the Europe/Paris civil week containing
 * "now". Shared by the questionnaire surface (J-C3) + the service so the wizard
 * and the upsert can NEVER disagree on "this week" across a midnight boundary.
 *
 * Anti-flake invariant (PR#96): the anchor goes through `localDateOf(...,
 * 'Europe/Paris')` + `parseLocalDate` + Monday math — NEVER
 * `new Date().toISOString().slice(0, 10)` nor `getUTCDay()` on a naive instant.
 * Europe/Paris is the V1 cohort timezone (all members FR). Pure (no DB),
 * deterministic given the clock. This module imports ONLY the canonical TZ
 * helpers — zero real-edge (P&L) dependency, §21.5/§27.7-clean.
 */
export function currentParisWeekStart(now: Date = new Date()): string {
  const todayParis = localDateOf(now, 'Europe/Paris');
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
}

const FMT_DAY_FR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** Human FR label for the planned week, e.g. "8 juin → 14 juin". */
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

/** `weekEnd` = `weekStart + 6 j`, service-side single source of truth. */
export function weekEndFromWeekStart(weekStart: string): string {
  const probe = parseLocalDate(weekStart);
  probe.setUTCDate(probe.getUTCDate() + 6);
  return probe.toISOString().slice(0, 10);
}
