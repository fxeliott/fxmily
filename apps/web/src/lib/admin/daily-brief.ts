import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { sendAdminDailyBriefEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

import { getTriageQueueCounts } from './attention-service';

/**
 * Tour 15 — daily ADMIN brief (« mon tableau de bord du matin »).
 *
 * One calm, count-only email sent once a day to the operator so the coach starts
 * the day knowing where to look, without opening the app. It REUSES the signals
 * the app already computes — nothing here recomputes a score or a scan:
 *   - the triage queue counts (`getTriageQueueCounts` — the same numbers the
 *     `/admin/a-traiter` page badges, including the Tour-15 behavioral-signal
 *     count),
 *   - the behavioral signals that fired in the LAST 24h (a bounded read of the
 *     already-stored `MarkDouglasDelivery.triggeredBy` labels, grouped per
 *     member — the "what changed since yesterday" delta),
 *   - the members drifting away (a bounded read of `User.lastSeenAt` — the
 *     already-stored engagement signal).
 *
 * PII-FREE by construction (mirror of the §26 calendar / §25 monthly / J8 weekly
 * nudges): the brief carries COUNTS only — never a member name, email, P&L, or
 * the free-text of a signal. It is ADMIN-facing (`WEEKLY_REPORT_RECIPIENT`), so
 * the deep-links point at the admin surfaces (the triage page, each member fiche)
 * where the identity lives behind auth, never in the email body.
 *
 * It NEVER drives Claude and NEVER mutates member data: a pure read + one
 * heartbeat audit row (`cron.admin_daily_brief.scan`) consumed by
 * `lib/system/health.ts`, so a broken brief cron surfaces red like the others.
 */

const DAY_MS = 86_400_000;

/** Window for the "new since yesterday" behavioral-signal delta. */
const NEW_SIGNAL_WINDOW_MS = DAY_MS;

/**
 * A member is "drifting" (en décrochage) when they are active but have not been
 * seen for this long. 7 days is the same recency horizon the behavioral-signal
 * section uses — long enough not to flag a member merely taking a weekend off,
 * short enough that a real disengagement surfaces within the week.
 */
const DISENGAGED_AFTER_MS = 7 * DAY_MS;

export interface AdminDailyBrief {
  /** Triage queue counts (reused from `getTriageQueueCounts`). */
  readonly triage: {
    readonly uncommentedClosed: number;
    readonly staleOpen: number;
    readonly openDiscrepancies: number;
    readonly behavioralSignals: number;
    readonly total: number;
  };
  /** Distinct members with ≥1 behavioral signal in the last 24h (the delta). */
  readonly newSignalMembers: number;
  /** Total behavioral deliveries in the last 24h (context for the delta). */
  readonly newSignalDeliveries: number;
  /** Active members not seen for ≥ `DISENGAGED_AFTER_MS` (drifting away). */
  readonly disengagedMembers: number;
  /** ISO instant the brief was composed. */
  readonly composedAt: string;
}

/**
 * Compose the daily brief from already-stored signals. Pure read: three bounded
 * queries in parallel on top of the triage counts, all over indexed columns
 * (`markDouglasDelivery(userId, createdAt)`, `user(status, deletedAt)`).
 */
export async function composeAdminDailyBrief(
  options: { now?: Date } = {},
): Promise<AdminDailyBrief> {
  const now = options.now ?? new Date();
  const signalFloor = new Date(now.getTime() - NEW_SIGNAL_WINDOW_MS);
  const disengagedFloor = new Date(now.getTime() - DISENGAGED_AFTER_MS);

  const [triage, newSignalGroups, newSignalDeliveries, disengagedMembers] = await Promise.all([
    getTriageQueueCounts(),
    // Distinct members with a delivery in the last 24h — the "new since
    // yesterday" delta. groupBy(['userId']) → one row per member, .length =
    // distinct members. Non-deleted only (mirror the loader).
    db.markDouglasDelivery.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: signalFloor },
        user: { status: { not: 'deleted' } },
      },
    }),
    db.markDouglasDelivery.count({
      where: {
        createdAt: { gte: signalFloor },
        user: { status: { not: 'deleted' } },
      },
    }),
    // Drifting members: active, never soft-deleted, and either last seen before
    // the floor OR never seen at all while having joined before the floor (a
    // brand-new member with no session yet is NOT drifting — they just arrived).
    db.user.count({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [
          { lastSeenAt: { lt: disengagedFloor } },
          { lastSeenAt: null, joinedAt: { lt: disengagedFloor } },
        ],
      },
    }),
  ]);

  return {
    triage: {
      uncommentedClosed: triage.uncommentedClosed,
      staleOpen: triage.staleOpen,
      openDiscrepancies: triage.openDiscrepancies,
      behavioralSignals: triage.behavioralSignals,
      total: triage.total,
    },
    newSignalMembers: newSignalGroups.length,
    newSignalDeliveries,
    disengagedMembers,
    composedAt: now.toISOString(),
  };
}

export type DailyBriefEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface AdminDailyBriefResult extends AdminDailyBrief {
  emailOutcome: DailyBriefEmailOutcome;
}

/**
 * Compose the brief + email it to the operator, then heartbeat. Side-effect
 * bounded, mirror of `runWeeklyReportOverdueAlert`:
 *   - ALWAYS one PII-free heartbeat audit (`cron.admin_daily_brief.scan`)
 *     consumed by `lib/system/health.ts` — emitted every run so a broken brief
 *     never blinds the monitor.
 *   - the admin email is best-effort (`WEEKLY_REPORT_RECIPIENT`): a delivery
 *     failure degrades to a Sentry warning and is recorded in the heartbeat, it
 *     never throws back into the cron.
 *
 * Unlike the overdue nudges, the brief is sent EVERY day (it is a standing
 * report, not a conditional alert) — a totally empty day still gets a calm
 * "rien ne réclame ton attention" email, which is itself the signal the operator
 * wants (silence would be indistinguishable from a broken cron).
 */
export async function runAdminDailyBrief(
  options: { now?: Date } = {},
): Promise<AdminDailyBriefResult> {
  const brief = await composeAdminDailyBrief(options);

  let emailOutcome: DailyBriefEmailOutcome = 'not_attempted';

  const recipient = env.WEEKLY_REPORT_RECIPIENT;
  if (recipient) {
    try {
      const { delivered } = await sendAdminDailyBriefEmail({ to: recipient, brief });
      emailOutcome = delivered ? 'sent' : 'skipped';
    } catch (err) {
      emailOutcome = 'failed';
      reportWarning('cron.admin-daily-brief', 'admin_email_failed', {
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
    }
  }

  await logAudit({
    action: 'cron.admin_daily_brief.scan',
    metadata: {
      triageTotal: brief.triage.total,
      uncommentedClosed: brief.triage.uncommentedClosed,
      staleOpen: brief.triage.staleOpen,
      openDiscrepancies: brief.triage.openDiscrepancies,
      behavioralSignals: brief.triage.behavioralSignals,
      newSignalMembers: brief.newSignalMembers,
      disengagedMembers: brief.disengagedMembers,
      emailOutcome,
      composedAt: brief.composedAt,
    },
  });

  return { ...brief, emailOutcome };
}
