import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { sendWeeklyReportOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

import { formatWeekRangeFr } from '@/lib/calendar/week';

import { computePreviousFullWeekWindow, type WeekWindow } from './week-window';

/**
 * J8 weekly report — permanence safety-net (4th twin of the §26 calendar /
 * §25 monthly / S2 onboarding overdue nets).
 *
 * The admin weekly digest (SPEC §7.10) is generated via `claude --print` LOCAL
 * on the operator's machine (ban-risk human-in-the-loop §5.4), triggered by
 * hand (`ops/scripts/weekly-batch-local.sh`, "Monday for the week that just
 * closed"). The prod Sunday-21:00-UTC cron exists, but in the local-batch
 * operating mode the report is pulled manually — so the silent failure mode is
 * the exact twin of the calendar/monthly gaps: a full week ends, the admin
 * forgets the batch, and the weekly digest (one `WeeklyReport` row per active
 * member, covering the previous full week) silently never gets generated.
 *
 * This module is the safety-net (mirror of `lib/monthly-debrief/overdue.ts`): a
 * read-only scan, run by a daily server cron, that nudges the ADMIN when the
 * last completed week's reports are missing past a grace window. It never drives
 * Claude — it only counts rows and emails the operator. Pure-read, count-only
 * (no narrative / P&L / member free-text leaves it). The digest is ADMIN-facing,
 * so there is NO member field: coverage = a `WeeklyReport` row EXISTS for the
 * target week (if the batch never ran → 0 rows → overdue).
 */

/**
 * Grace (days after week-end) before the missing reports are "overdue". The
 * batch is ops-run on Monday for the week that closed Sunday ; we never nudge in
 * the first days of the new week — the admin gets a calm buffer to run it. 2
 * days ⇒ a nudge starts ~Wednesday if last week's reports are still missing.
 */
const OVERDUE_GRACE_DAYS = 2;

/** V1 cohort timezone — all members are Europe/Paris (mirror calendar/week). */
const COHORT_TZ = 'Europe/Paris';

/**
 * The most-recently-COMPLETED full Mon→Sun week relative to `now` (Europe/Paris).
 *
 * Delegates to `computePreviousFullWeekWindow` (zero duplication): it returns
 * EXACTLY the previous full civil week regardless of the day the cron runs. This
 * is the same window the batch targets when pulled "for the week that closed"
 * (`previousFullWeek: true`), so the batch and this net converge on the same
 * `weekStart` by construction — no infinite-nudge loop where the admin generates
 * one week and the net waits on another.
 *
 * ⚠️ Caveat multi-TZ (Paris-only V1 cohort): convergence GUARANTEED for the
 * 100 % Europe/Paris cohort. The net forces `COHORT_TZ='Europe/Paris'` ; for a
 * non-Paris member, batch and net could target different weeks at a week
 * boundary. Pre-existing divergence, inert while the cohort is mono-TZ ; close
 * it (pass the member TZ to the scan) if a multi-TZ cohort is born.
 */
function lastCompletedWeek(now: Date): WeekWindow {
  return computePreviousFullWeekWindow(now, COHORT_TZ);
}

export interface OverdueWeeklyScan {
  /** YYYY-MM-DD (Europe/Paris Monday) of the last completed full week. */
  weekStart: string;
  /** Human FR week range, e.g. "8 juin → 14 juin" — for the admin email/audit. */
  weekRange: string;
  /** Active members (joined on/before the week ended) WITHOUT a `WeeklyReport`
   *  row for `weekStart`. The digest is admin-facing (no member field), so
   *  coverage is the simple EXISTENCE of the row — if the batch never ran, 0
   *  rows → every expected member is overdue. Floored at `joinedAt` so a member
   *  who joined AFTER the week ended is never flagged. 0 while within grace. */
  overdueCount: number;
  /** Active members expected a report for the week (joined on/before its end). */
  expectedCount: number;
  /** True if `now` is still inside the post-week-end grace window. */
  withinGrace: boolean;
  /** ISO instant of the scan. */
  scannedAt: string;
}

/**
 * Read-only scan of the last completed full week. Two parallel index-bounded
 * reads (active users floored at joinedAt + reports for the week). No writes.
 */
export async function scanOverdueWeeklyReports(
  options: { now?: Date } = {},
): Promise<OverdueWeeklyScan> {
  const now = options.now ?? new Date();
  const window = lastCompletedWeek(now);
  const weekStart = window.weekStartLocal;
  const graceThreshold = new Date(
    window.weekEndUtc.getTime() + OVERDUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  const withinGrace = now < graceThreshold;

  const [activeUsers, reportRows] = await Promise.all([
    db.user.findMany({
      // Floor at joinedAt: a member who joined AFTER the week ended was not a
      // member during it → no report expected (mirror monthly join-floor canon).
      where: { status: 'active', joinedAt: { lte: window.weekEndUtc } },
      select: { id: true },
    }),
    db.weeklyReport.findMany({
      where: { weekStart: parseLocalDate(weekStart) },
      select: { userId: true },
    }),
  ]);

  // Coverage = a report row EXISTS for the member this week (the digest is
  // admin-facing, no per-member delivery field — DoD is generation, not member
  // delivery). A missing row → the member is overdue → the admin re-runs the
  // batch → the upsert fills it → self-heal convergent.
  const haveReport = new Set(reportRows.map((r) => r.userId));
  const missing = activeUsers.filter((u) => !haveReport.has(u.id)).length;

  return {
    weekStart,
    weekRange: formatWeekRangeFr(weekStart),
    overdueCount: withinGrace ? 0 : missing,
    expectedCount: activeUsers.length,
    withinGrace,
    scannedAt: now.toISOString(),
  };
}

export type OverdueAlertEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface WeeklyReportOverdueAlertResult extends OverdueWeeklyScan {
  alerted: boolean;
  emailOutcome: OverdueAlertEmailOutcome;
}

/**
 * Scan + (if overdue) nudge the admin. Side-effect-bounded, mirror of
 * `runMonthlyDebriefOverdueAlert`:
 *   - ALWAYS one PII-free heartbeat audit (`cron.weekly_report_overdue.scan`)
 *     consumed by `lib/system/health.ts` — emitted every run, so an overdue
 *     week never blinds the monitor.
 *   - overdue > 0 → admin email (best-effort, `WEEKLY_REPORT_RECIPIENT`) +
 *     `reportWarning`. Email failure degrades to the Sentry warning, never
 *     throws back into the cron.
 *
 * Anti-spam by cadence (daily) : ≤ 1 nudge/day while overdue, stops the moment
 * the weekly batch is run.
 */
export async function runWeeklyReportOverdueAlert(
  options: { now?: Date } = {},
): Promise<WeeklyReportOverdueAlertResult> {
  const scan = await scanOverdueWeeklyReports(options);

  let emailOutcome: OverdueAlertEmailOutcome = 'not_attempted';

  if (scan.overdueCount > 0) {
    reportWarning('cron.weekly-report-overdue', 'weekly_reports_overdue', {
      weekStart: scan.weekStart,
      overdueCount: scan.overdueCount,
      expectedCount: scan.expectedCount,
    });

    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      try {
        const { delivered } = await sendWeeklyReportOverdueAlertEmail({
          to: recipient,
          overdueCount: scan.overdueCount,
          expectedCount: scan.expectedCount,
          weekRange: scan.weekRange,
        });
        emailOutcome = delivered ? 'sent' : 'skipped';
      } catch (err) {
        emailOutcome = 'failed';
        reportWarning('cron.weekly-report-overdue', 'admin_email_failed', {
          weekStart: scan.weekStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
  }

  await logAudit({
    action: 'cron.weekly_report_overdue.scan',
    metadata: {
      weekStart: scan.weekStart,
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
