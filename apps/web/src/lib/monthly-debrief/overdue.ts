import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { sendMonthlyDebriefOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

import { formatMonthLabelFr } from './format';
import { computeReportingMonth, type MonthWindow } from './month-window';

/**
 * V1.4 §25 monthly debrief — permanence safety-net (Session 5, DoD#2
 * "rapports générés automatiquement, sans intervention").
 *
 * The monthly member debrief is generated via `claude --print` LOCAL on the
 * operator's machine (ban-risk human-in-the-loop §5.4), triggered by hand
 * (`ops/scripts/monthly-batch-local.sh`, "1st of the month") — there is NO
 * monthly cron (the local Opus path can't be auto-driven without raising the
 * ban risk). The silent failure mode is the exact twin of the §26 calendar
 * gap: a completed month ends, the admin forgets the batch, and every active
 * member silently never receives their monthly debrief (SPEC §25.4 mandates
 * ONE debrief per active member, every month).
 *
 * This module is the safety-net (mirror of `lib/calendar/overdue.ts`): a
 * read-only scan, run by a daily server cron, that nudges the ADMIN when the
 * last completed month's debriefs are missing past a grace window. It never
 * drives Claude — it only counts rows and emails the operator. Pure-read,
 * §25.7-clean (counts only, no narrative / P&L / member free-text leaves it).
 */

/**
 * Grace (days after month-end) before the missing debriefs are "overdue". The
 * batch is ops-scheduled for the 1st ; we never nudge in the first days of the
 * new month — the admin gets a calm buffer to run it. 4 days ⇒ a nudge starts
 * ~the 5th if last month's debriefs are still missing.
 */
const OVERDUE_GRACE_DAYS = 4;

/** V1 cohort timezone — all members are Europe/Paris (mirror calendar/week). */
const COHORT_TZ = 'Europe/Paris';

/**
 * The most-recently-COMPLETED civil month relative to `now` (Europe/Paris).
 *
 * DÉLÈGUE désormais à `computeReportingMonth` (zéro duplication) : depuis le
 * fix TIER1, ce dernier renvoie EXACTEMENT le dernier mois civil complété de
 * façon robuste, quel que soit le jour du run. C'est volontaire et critique :
 * le batch (loader → `computeReportingMonth`) et le net overdue (cette fonction)
 * DOIVENT cibler le même `monthStart`, sinon l'admin génère un mois et le nudge
 * en attend un autre → boucle de nudge infinie (le défaut B d'origine). En
 * partageant la même source, batch et net convergent par construction.
 *
 * ⚠️ Caveat multi-TZ (cohorte Paris V1) : convergence GARANTIE pour la cohorte
 * 100 % Europe/Paris. Le net force `COHORT_TZ='Europe/Paris'` alors que le batch
 * utilise `user.timezone` (loader) — pour un membre non-Paris, batch et net
 * pourraient cibler des mois différents à la frontière de mois. Divergence
 * PRÉEXISTANTE (non introduite par le fix B), inerte tant que la cohorte est
 * mono-TZ ; à fermer (passer la TZ membre au scan) si une cohorte multi-TZ naît.
 */
function lastCompletedMonth(now: Date): MonthWindow {
  return computeReportingMonth(now, COHORT_TZ);
}

export interface OverdueMonthlyScan {
  /** YYYY-MM-01 (Europe/Paris) of the last completed civil month. */
  monthStart: string;
  /** Human FR month label, e.g. "mai 2026" — for the admin email/audit. */
  monthLabel: string;
  /** Active members (joined on/before the month ended) dont le débrief n'a PAS
   *  été DÉLIVRÉ pour `monthStart`. La couverture est la DÉLIVRANCE au membre
   *  (`sentToMemberAt !== null`), PAS la simple existence d'une row — DoD#2
   *  exige la délivrance, pas seulement la génération. Mirror de la promesse
   *  batch « chaque membre actif reçoit le sien » (SPEC §25.4), floored à
   *  `joinedAt` pour ne jamais flagger à tort un membre arrivé APRÈS le mois.
   *  0 tant qu'on est dans la fenêtre de grâce. */
  overdueCount: number;
  /** Active members expected a debrief for the month (joined on/before its end). */
  expectedCount: number;
  /** True if `now` is still inside the post-month-end grace window. */
  withinGrace: boolean;
  /** ISO instant of the scan. */
  scannedAt: string;
}

/**
 * Read-only scan of the last completed civil month. Two parallel index-bounded
 * reads (active users floored at joinedAt + debriefs for the month). No writes.
 */
export async function scanOverdueMonthlyDebriefs(
  options: { now?: Date } = {},
): Promise<OverdueMonthlyScan> {
  const now = options.now ?? new Date();
  const reporting = lastCompletedMonth(now);
  const monthStart = reporting.monthStartLocal;
  const graceThreshold = new Date(
    reporting.monthEndUtc.getTime() + OVERDUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  const withinGrace = now < graceThreshold;

  const [activeUsers, debriefRows] = await Promise.all([
    db.user.findMany({
      // Floor at joinedAt: a member who joined AFTER the month ended was not a
      // member during it → no debrief expected (mirror meeting join-floor canon).
      where: { status: 'active', joinedAt: { lte: reporting.monthEndUtc } },
      select: { id: true },
    }),
    db.monthlyDebrief.findMany({
      where: { monthStart: parseLocalDate(monthStart) },
      // On lit `sentToMemberAt` : la couverture = DÉLIVRANCE, pas existence de
      // row (FIX TIER2). Si la dispatch a échoué (batch outer catch →
      // reportWarning Sentry-only, `sentToMemberAt` reste null), la row existe
      // mais le membre n'a rien reçu — il doit redevenir overdue.
      select: { userId: true, sentToMemberAt: true },
    }),
  ]);

  // Un membre n'est COUVERT que si un débrief DÉLIVRÉ existe. Une row persistée-
  // mais-non-délivrée (`sentToMemberAt === null`) redevient overdue → l'admin
  // re-lance le batch → la dispatch se re-tente (le batch ne dispatch que si
  // `sentToMemberAt === null`) → self-heal convergent (DoD#2).
  const haveDebrief = new Set(
    debriefRows.filter((r) => r.sentToMemberAt !== null).map((r) => r.userId),
  );
  const missing = activeUsers.filter((u) => !haveDebrief.has(u.id)).length;

  return {
    monthStart,
    monthLabel: formatMonthLabelFr(monthStart),
    overdueCount: withinGrace ? 0 : missing,
    expectedCount: activeUsers.length,
    withinGrace,
    scannedAt: now.toISOString(),
  };
}

export type OverdueAlertEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface MonthlyDebriefOverdueAlertResult extends OverdueMonthlyScan {
  alerted: boolean;
  emailOutcome: OverdueAlertEmailOutcome;
}

/**
 * Scan + (if overdue) nudge the admin. Side-effect-bounded, mirror of
 * `runCalendarOverdueAlert`:
 *   - ALWAYS one PII-free heartbeat audit (`cron.monthly_debrief_overdue.scan`)
 *     consumed by `lib/system/health.ts` — emitted every run, so an overdue
 *     month never blinds the monitor.
 *   - overdue > 0 → admin email (best-effort, `WEEKLY_REPORT_RECIPIENT`) +
 *     `reportWarning`. Email failure degrades to the Sentry warning, never
 *     throws back into the cron.
 *
 * Anti-spam by cadence (daily) : ≤ 1 nudge/day while overdue, stops the moment
 * the monthly batch is run.
 */
export async function runMonthlyDebriefOverdueAlert(
  options: { now?: Date } = {},
): Promise<MonthlyDebriefOverdueAlertResult> {
  const scan = await scanOverdueMonthlyDebriefs(options);

  let emailOutcome: OverdueAlertEmailOutcome = 'not_attempted';

  if (scan.overdueCount > 0) {
    reportWarning('cron.monthly-debrief-overdue', 'monthly_debriefs_overdue', {
      monthStart: scan.monthStart,
      overdueCount: scan.overdueCount,
      expectedCount: scan.expectedCount,
    });

    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      try {
        const { delivered } = await sendMonthlyDebriefOverdueAlertEmail({
          to: recipient,
          overdueCount: scan.overdueCount,
          expectedCount: scan.expectedCount,
          monthLabel: scan.monthLabel,
        });
        emailOutcome = delivered ? 'sent' : 'skipped';
      } catch (err) {
        emailOutcome = 'failed';
        reportWarning('cron.monthly-debrief-overdue', 'admin_email_failed', {
          monthStart: scan.monthStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
  }

  await logAudit({
    action: 'cron.monthly_debrief_overdue.scan',
    metadata: {
      monthStart: scan.monthStart,
      overdueCount: scan.overdueCount,
      expectedCount: scan.expectedCount,
      withinGrace: scan.withinGrace,
      alerted: scan.overdueCount > 0,
      emailOutcome,
      scannedAt: scan.scannedAt,
    },
  });

  return { ...scan, alerted: scan.overdueCount > 0, emailOutcome };
}
