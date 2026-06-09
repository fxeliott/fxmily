import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { sendCalendarOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

import { currentParisWeekStart, formatWeekRangeFr } from './week';

/**
 * §26 Calendrier adaptatif — permanence safety-net (Session 5, DoD#4).
 *
 * The calendar batch (`claude --print` local, ban-risk human-in-the-loop §5.4)
 * is triggered MANUALLY by the admin, by design — a fixed cron driving the
 * headless Claude binary would raise the ban risk. The unwanted side effect of
 * that design is a SILENT failure mode : a member fills the weekly schedule
 * questionnaire, the admin forgets to run the batch, and the member stays on
 * "ton calendrier se prépare" forever — no calendar, no alert, no one notified.
 *
 * This module is the safety-net that closes DoD#4 ("tout permanent/durable ;
 * 0 bug") WITHOUT touching the ban-risk trigger : a read-only scan, run by a
 * server cron, that nudges the ADMIN (not the member) when questionnaires have
 * been waiting past a grace window with no calendar. The human-in-the-loop stays
 * exactly as designed — the admin is simply reminded so nothing slips silently.
 *
 * Pure-read + §2-clean : it counts rows (questionnaires vs calendars) for the
 * current Europe/Paris week. NO P&L, NO member free-text, NO calendar content
 * reaches the alert — only counts + the week range. Firewall-clean (lives in
 * `lib/calendar/**`, the glob-isolated tree; imports zero real-edge module).
 */

/**
 * Grace window (hours) before a filled questionnaire is considered "overdue".
 * The batch is meant to run early in the week ; we never nudge the admin the
 * instant a member submits — they get a calm buffer to run it. 18h means a
 * Monday-morning fill won't surface until the Tuesday cron pass. Mirrors the
 * "give the operator a beat" cadence of the weekly digest (`sentToAdminAt`).
 */
const OVERDUE_GRACE_HOURS = 18;

export interface OverdueCalendarScan {
  /** Monday (YYYY-MM-DD, Europe/Paris) the scan is anchored to — the same
   *  week the batch would generate FOR (server-authority via
   *  `currentParisWeekStart`, never a client instant). */
  weekStart: string;
  /** Human FR range, e.g. "8 juin → 14 juin" — for the admin email/audit. */
  weekRange: string;
  /** Active members who filled the questionnaire > grace ago AND still have no
   *  AdaptiveCalendar for this week. This is EXACTLY the set the batch would
   *  generate (mirror of `loadAllSnapshotsForCalendarGeneration` candidates)
   *  minus the freshly-filled (grace) ones. */
  overdueCount: number;
  /** Total questionnaires submitted for this week (any age) — context for the
   *  admin ("3 attendent sur 5 organisés"). */
  questionnaireCount: number;
  /** ISO instant of the scan. */
  scannedAt: string;
}

/**
 * Read-only scan of the current Paris week. Mirrors the batch candidate query
 * (`active` ∩ `has questionnaire` ∩ `no calendar`) + the grace filter on
 * `createdAt`. Three parallel index-bounded reads ; no writes, no side effects.
 */
export async function scanOverdueCalendars(
  options: { now?: Date } = {},
): Promise<OverdueCalendarScan> {
  const now = options.now ?? new Date();
  const weekStart = currentParisWeekStart(now);
  const weekStartDb = parseLocalDate(weekStart);
  const graceThreshold = new Date(now.getTime() - OVERDUE_GRACE_HOURS * 60 * 60 * 1000);

  const [activeUsers, questionnaireRows, calendarRows] = await Promise.all([
    db.user.findMany({ where: { status: 'active' }, select: { id: true } }),
    // Questionnaires filled for this week, older than the grace window. We read
    // both the all-age count (questionnaireCount, for admin context) and the
    // grace-filtered set (the overdue candidates). One query, filter in JS —
    // the per-week row count is tiny (≤ cohort size).
    db.weeklyScheduleQuestionnaire.findMany({
      where: { weekStart: weekStartDb },
      select: { userId: true, createdAt: true },
    }),
    db.adaptiveCalendar.findMany({
      where: { weekStart: weekStartDb },
      select: { userId: true },
    }),
  ]);

  const active = new Set(activeUsers.map((u) => u.id));
  const hasCalendar = new Set(calendarRows.map((r) => r.userId));

  const overdueCount = questionnaireRows.filter(
    (q) => active.has(q.userId) && !hasCalendar.has(q.userId) && q.createdAt < graceThreshold,
  ).length;

  return {
    weekStart,
    weekRange: formatWeekRangeFr(weekStart),
    overdueCount,
    questionnaireCount: questionnaireRows.length,
    scannedAt: now.toISOString(),
  };
}

export type OverdueAlertEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface CalendarOverdueAlertResult extends OverdueCalendarScan {
  /** Whether an admin nudge was warranted (overdueCount > 0). */
  alerted: boolean;
  /** Outcome of the admin email step. `not_attempted` when nothing is overdue
   *  OR `WEEKLY_REPORT_RECIPIENT` is unset (Sentry + audit still fire). */
  emailOutcome: OverdueAlertEmailOutcome;
}

/**
 * Scan + (if overdue) nudge the admin. Side-effect-bounded :
 *
 *   - ALWAYS one PII-free heartbeat audit row (`cron.calendar_overdue.scan`,
 *     counts only) — the canonical "did the cron run" signal consumed by
 *     `lib/system/health.ts` (mirror of every other cron). Emitted on EVERY
 *     run regardless of outcome, so an overdue week never blinds the monitor.
 *   - overdue > 0 → admin email (best-effort, to `WEEKLY_REPORT_RECIPIENT`,
 *     the existing admin channel) + `reportWarning` (ops visibility, never
 *     misses). The email NEVER throws back into the cron — a Resend failure
 *     degrades to the Sentry warning, the alert is never lost.
 *
 * Anti-spam by cadence : the cron runs once daily, so the admin gets at most
 * one nudge per day while genuinely overdue (no state table, no dedup
 * bookkeeping) — and it stops the moment the batch is run.
 */
export async function runCalendarOverdueAlert(
  options: { now?: Date } = {},
): Promise<CalendarOverdueAlertResult> {
  const scan = await scanOverdueCalendars(options);

  let emailOutcome: OverdueAlertEmailOutcome = 'not_attempted';

  if (scan.overdueCount > 0) {
    // Ops-visible warning — fires regardless of email config so the signal is
    // never lost (Sentry breadcrumb + admin dashboard). PII-free (counts only).
    reportWarning('cron.calendar-overdue', 'calendars_overdue', {
      weekStart: scan.weekStart,
      overdueCount: scan.overdueCount,
      questionnaireCount: scan.questionnaireCount,
    });

    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      try {
        const { delivered } = await sendCalendarOverdueAlertEmail({
          to: recipient,
          overdueCount: scan.overdueCount,
          questionnaireCount: scan.questionnaireCount,
          weekRange: scan.weekRange,
        });
        emailOutcome = delivered ? 'sent' : 'skipped';
      } catch (err) {
        emailOutcome = 'failed';
        reportWarning('cron.calendar-overdue', 'admin_email_failed', {
          weekStart: scan.weekStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
  }

  // Single heartbeat audit on EVERY run (health-monitor source of truth).
  await logAudit({
    action: 'cron.calendar_overdue.scan',
    metadata: {
      weekStart: scan.weekStart,
      overdueCount: scan.overdueCount,
      questionnaireCount: scan.questionnaireCount,
      alerted: scan.overdueCount > 0,
      emailOutcome,
      scannedAt: scan.scannedAt,
    },
  });

  return { ...scan, alerted: scan.overdueCount > 0, emailOutcome };
}
