import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';

/**
 * V1.8 REFLECT — week helpers shared by the `/review` pages.
 *
 * **J10 correctif n°1 — l'ancre passe de UTC à Europe/Paris.**
 *
 * L'ancienne `currentWeekStartUTC()` calculait le lundi sur `getUTCDay()`,
 * alors que TOUT le reste de l'app vit en Europe/Paris : `calendar/week.ts`,
 * `mindset/week.ts`, `training-debrief/week.ts` — et, dans ce module même,
 * `weekly-review/reminders.ts:57` qui appelle déjà `currentParisWeekStart`.
 * Le rappel « remplis ta revue » et la revue elle-même ne parlaient donc pas
 * de la même semaine.
 *
 * Fenêtre de divergence réelle : `[lundi 00:00 Paris, lundi 00:00 UTC[`, soit
 * 2 h l'été et 1 h l'hiver. Un membre ouvrant `/review/new` le lundi à 00 h 30
 * heure de Paris se voyait proposer la semaine PRÉCÉDENTE — et la revue étant
 * un upsert sur `(userId, weekStart)`, il pouvait écraser la revue de la
 * semaine passée en croyant écrire celle qui commence.
 *
 * **Migration douce — aucune donnée n'est invalidée, et voici pourquoi.**
 * Les deux ancres rendent toujours un lundi ; elles ne diffèrent que sur
 * LEQUEL pendant la fenêtre ci-dessus. Toute ligne déjà en base porte donc un
 * `weekStart` qui reste un lundi valide, dans la fenêtre `[-35 j, +7 j]` du
 * schéma, et reste lisible à l'identique. Rien à remapper : le changement
 * porte sur la semaine PROPOSÉE, pas sur la semaine STOCKÉE. Le seul dégât
 * possible est antérieur (un écrasement déjà survenu pendant la fenêtre) et
 * n'est pas détectable a posteriori — un upsert ne laisse pas de trace de la
 * valeur remplacée.
 *
 * Pur + client-safe (aucun import `server-only`) : `checkin/timezone` n'utilise
 * qu'`Intl`, donc ce module reste testable en environnement node nu et
 * importable depuis un composant client.
 */

/**
 * Lundi (`YYYY-MM-DD`) de la semaine civile Europe/Paris contenant `now`.
 *
 * Invariant anti-flake (canon PR#96, partagé avec `calendar/week.ts`) : on
 * passe par `localDateOf(..., 'Europe/Paris')` + `parseLocalDate` + math-lundi,
 * JAMAIS `new Date().toISOString().slice(0, 10)` ni `getUTCDay()` sur un
 * instant naïf. Europe/Paris est le fuseau de la cohorte V1 (membres FR).
 */
export function currentParisWeekStart(now: Date = new Date()): string {
  const todayParis = localDateOf(now, 'Europe/Paris');
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
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
