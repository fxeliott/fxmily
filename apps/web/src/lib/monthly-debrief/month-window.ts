import 'server-only';

import { localDateOf, parseLocalDate, type LocalDateString } from '@/lib/checkin/timezone';
import { localInstantToUtc } from '@/lib/weekly-report/week-window';

/**
 * Civil-month window helpers for the V1.4 monthly AI debrief (SPEC §25).
 *
 * The monthly batch (SPEC §25.4) runs on the 1st of the month and emits 1
 * debrief per active member, covering the **previous full civil month** in
 * the member's timezone (1st 00:00:00 → last-day 23:59:59.999 local-time,
 * expressed as UTC instants).
 *
 * V1 cohort is Europe/Paris-only in practice, but `User.timezone` already
 * exists so we honor it from day 1 — same posture as `weekly-report/
 * week-window.ts` (this module is its civil-month carbon: it reuses
 * `localInstantToUtc` / `shiftLocalDateString` / `parseLocalDate` /
 * `localDateOf` rather than re-deriving the DST-safe Intl maths).
 *
 * Importing `@/lib/weekly-report/week-window` is §21.5-clean: it is pure
 * date arithmetic with zero training reference and is NOT a real-edge
 * surface (the anti-leak Block A globs `lib/weekly-report/builder.ts`
 * only). WeeklyReport is the sanctioned INPUT source for the monthly
 * debrief (SPEC §25.3) — the §25 firewall is about training-P&L isolation,
 * not weekly-report isolation. See `test/anti-leak/training-isolation.test.ts`
 * Block G.
 */

export interface MonthWindow {
  /// YYYY-MM-01 (1st of the civil month, member-local).
  monthStartLocal: LocalDateString;
  /// YYYY-MM-DD (last calendar day of the civil month, member-local).
  monthEndLocal: LocalDateString;
  /// UTC instant: member-local 1st-of-month 00:00:00.000 in `timezone`.
  monthStartUtc: Date;
  /// UTC instant: member-local last-day 23:59:59.999 in `timezone`.
  monthEndUtc: Date;
}

/** First day (`YYYY-MM-01`) of the civil month a local date belongs to. */
function firstOfMonth(local: LocalDateString): LocalDateString {
  const [y, m] = local.split('-');
  return `${y}-${m}-01`;
}

/**
 * Compute the civil-month window **containing** `now` in the member's TZ
 * (the "current month" semantic — mirror `computeWeekWindow`).
 *
 * The last day of the month is derived branch-free via `Date.UTC(y, m, 0)`
 * (day 0 of the *next* month = last day of the queried month), which is
 * leap-year correct (Feb 28/29) without a lookup table.
 */
export function computeMonthWindow(now: Date, timezone: string): MonthWindow {
  const todayLocal = localDateOf(now, timezone);
  const monthStartLocal = firstOfMonth(todayLocal);

  const [yStr, mStr] = monthStartLocal.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1-based
  // Day 0 of the next month = last calendar day of THIS month (28/29/30/31).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEndLocal: LocalDateString = `${yStr}-${mStr}-${`${lastDay}`.padStart(2, '0')}`;

  return {
    monthStartLocal,
    monthEndLocal,
    monthStartUtc: localInstantToUtc(monthStartLocal, 0, 0, 0, 0, timezone),
    monthEndUtc: localInstantToUtc(monthEndLocal, 23, 59, 59, 999, timezone),
  };
}

/**
 * "Reporting month" — le DERNIER MOIS CIVIL COMPLÉTÉ en local-TZ membre,
 * cible du batch mensuel. **Robuste à un run retardé de plusieurs jours**
 * (batch manuel sans cron, SPEC §25.4 — l'admin lance le script à la main
 * « le 1er du mois », mais en pratique le 5, le 20, ou le dernier jour).
 *
 * Implémentation (canon `overdue.lastCompletedMonth`) : prends le mois civil
 * COURANT contenant `now`, recule de 1ms avant son début (→ dernier instant
 * du mois précédent), reprends le mois civil contenant cet instant. Une seule
 * règle, sans branchement, DST-safe (l'arithmétique passe par les bornes UTC
 * du mois courant, jamais par un offset fixe).
 *
 * Pourquoi PAS l'ancien `now − 24h` : cette ancre n'est correcte QUE pour un
 * run très tôt le 1er. Lancé le 5 juin, `now − 24h` = 4 juin → mois COURANT
 * (juin, incomplet) au lieu de mai → le batch génère le mauvais mois, mai
 * n'est jamais générée et le nudge overdue (qui, lui, calcule le vrai dernier
 * mois complété) tourne en boucle. Le nouveau calcul converge avec l'overdue
 * net QUEL QUE SOIT le jour du run :
 *   - 1er juin 00:05 Paris → mois courant juin → recul 1ms → MAI ✓
 *   - 5 / 20 / dernier jour de juin → mois courant juin → recul 1ms → MAI ✓
 *
 * Multi-TZ-safe : pour une TZ à l'ouest d'UTC, un run 02:00 UTC le 1er est
 * encore le mois précédent *localement* — on part du mois courant LOCAL, donc
 * pas de saut à deux-mois-avant (couvert par le cas multi-TZ NY du test).
 */
export function computeReportingMonth(now: Date, timezone: string): MonthWindow {
  const current = computeMonthWindow(now, timezone);
  const prevAnchor = new Date(current.monthStartUtc.getTime() - 1);
  return computeMonthWindow(prevAnchor, timezone);
}

/**
 * Recompute the exact window of an already-persisted debrief from its
 * `monthStart` (`YYYY-MM-DD`, member-local 1st-of-month). Deterministic
 * SSOT used by the admin read path so a recomputed view never drifts from
 * what the batch persisted. `monthEnd` is ALWAYS service-computed here,
 * never accepted from a client (anti-tamper, SPEC §25.3/§25.7).
 */
export function monthWindowFromMonthStart(
  monthStartLocal: LocalDateString,
  timezone: string,
): MonthWindow {
  const ref = parseLocalDate(monthStartLocal); // UTC midnight of the 1st
  return computeMonthWindow(ref, timezone);
}
