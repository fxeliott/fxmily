import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { sendMonthlyDebriefOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

import { formatMonthLabelFr } from './format';
import { computeMonthWindow, type MonthWindow } from './month-window';

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
 * Distinct from `computeReportingMonth` (which is `now − 24h`-anchored for the
 * 1st-of-month batch run): here we always want the FULL previous month, even
 * mid-month — step back 1ms before the current month's start and take the
 * civil month containing that instant.
 */
function lastCompletedMonth(now: Date): MonthWindow {
  const current = computeMonthWindow(now, COHORT_TZ);
  const prevAnchor = new Date(current.monthStartUtc.getTime() - 1);
  return computeMonthWindow(prevAnchor, COHORT_TZ);
}

export interface OverdueMonthlyScan {
  /** YYYY-MM-01 (Europe/Paris) of the last completed civil month. */
  monthStart: string;
  /** Human FR month label, e.g. "mai 2026" — for the admin email/audit. */
  monthLabel: string;
  /** Active members (joined on/before the month ended) with NO MonthlyDebrief
   *  for `monthStart`. Mirror of the batch's "every active member gets one"
   *  (SPEC §25.4), floored at `joinedAt` so a member who joined AFTER the month
   *  is never falsely flagged. 0 while within the grace window. */
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
      select: { userId: true },
    }),
  ]);

  const haveDebrief = new Set(debriefRows.map((r) => r.userId));
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
