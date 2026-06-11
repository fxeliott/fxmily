import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { sendOnboardingProfileOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

/**
 * S2 — onboarding profile permanence safety-net (3rd twin of the permanence
 * net class : §26 calendar `lib/calendar/overdue.ts` + §25 monthly
 * `lib/monthly-debrief/overdue.ts`).
 *
 * The onboarding profiling pipeline is : member completes the 30Q interview
 * (`OnboardingInterview.status='completed'`) → MANUAL local Claude batch
 * (`ops/scripts/onboarding-batch-local.sh`, ban-risk human-in-the-loop §5.4 —
 * the generation is NEVER cronned) → `MemberProfile` persisted. The silent
 * failure mode is the exact twin of the calendar/monthly gaps : the admin
 * forgets the batch, and a member who completed their interview NEVER gets
 * their profile — while TWO member-facing screens promise it « dans les
 * prochaines 24h » (`app/profile/page.tsx:148` +
 * `app/onboarding/interview/complete/page.tsx:69`).
 *
 * This module is the safety-net : a read-only scan, run by a daily server
 * cron, that nudges the ADMIN when completed interviews are missing their
 * profile past the grace window. It never drives Claude — it only counts rows
 * and emails the operator. Pure-read, posture §2-clean (counts + a timestamp
 * only ; no answers, no member id, no free-text leaves it).
 */

/**
 * Grace (hours after interview completion) before a missing profile is
 * "overdue". 24h IS the member-facing promise — both screens say the profile
 * arrives « dans les prochaines 24h », so the nudge starts exactly when the
 * promise expires. Unlike the monthly net (global month window) the grace
 * here is PER-INTERVIEW : each completion opens its own 24h window.
 */
const OVERDUE_GRACE_HOURS = 24;

export interface OverdueOnboardingProfileScan {
  /** Completed interviews of ACTIVE members with no `MemberProfile`, whose
   *  24h member-facing promise has expired (completedAt ≤ now − 24h). The
   *  coverage is the EXISTENCE of the 1-1 `profile` relation — the batch
   *  persists the profile in the same transaction as its delivery surface
   *  (the member dashboard reads the row directly, there is no separate
   *  dispatch step to track, unlike the monthly `sentToMemberAt`).
   *  0 while every pending interview is still inside its grace window. */
  overdueCount: number;
  /** ISO instant of the OLDEST overdue completion (how long the most patient
   *  member has been waiting), or null when nothing is overdue. A bare
   *  timestamp — deliberately the only non-count field, PII-free. */
  oldestCompletedAt: string | null;
  /** True when there ARE profile-less completed interviews but every one of
   *  them is still inside its 24h grace (promise not yet broken → calm). */
  withinGrace: boolean;
  /** ISO instant of the scan. */
  scannedAt: string;
}

/**
 * Read-only scan. ONE index-bounded read : the Prisma relation filters push
 * the whole candidate logic (completed + active member + no profile) into a
 * single query on `@@index([status, completedAt])` ; the per-interview grace
 * split is done in JS on the returned timestamps. No writes. The select is
 * `completedAt` only — no member id, no answer text (PII-free by construction).
 */
export async function scanOverdueOnboardingProfiles(
  options: { now?: Date } = {},
): Promise<OverdueOnboardingProfileScan> {
  const now = options.now ?? new Date();
  const graceThreshold = new Date(now.getTime() - OVERDUE_GRACE_HOURS * 60 * 60 * 1000);

  const rows = await db.onboardingInterview.findMany({
    where: {
      // Only finalized interviews — started/in_progress/abandoned never owe a
      // profile (the batch only consumes `completed` rows).
      status: 'completed',
      // Defensive : `completed` implies completedAt is set (finalize() flips
      // both), but the column is nullable — never let a null pass as overdue.
      completedAt: { not: null },
      // A member who left (soft-delete / deletion pipeline) is no longer owed
      // a profile — mirror of the monthly net's `status: 'active'` filter.
      user: { status: 'active' },
      // The 1-1 relation is the coverage check : profile generated → covered.
      profile: { is: null },
    },
    select: { completedAt: true },
  });

  const completedAts = rows.map((r) => r.completedAt).filter((d): d is Date => d !== null);

  // Per-interview grace : overdue ⇔ the 24h promise has fully elapsed. `≤` on
  // purpose — at exactly +24h the promise « dans les prochaines 24h » is broken.
  const overdue = completedAts.filter((d) => d.getTime() <= graceThreshold.getTime());
  const oldestOverdue = overdue.length > 0 ? overdue.reduce((min, d) => (d < min ? d : min)) : null;

  return {
    overdueCount: overdue.length,
    oldestCompletedAt: oldestOverdue ? oldestOverdue.toISOString() : null,
    withinGrace: overdue.length === 0 && completedAts.length > 0,
    scannedAt: now.toISOString(),
  };
}

export type OverdueAlertEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface OnboardingProfileOverdueAlertResult extends OverdueOnboardingProfileScan {
  alerted: boolean;
  emailOutcome: OverdueAlertEmailOutcome;
}

/**
 * Scan + (if overdue) nudge the admin. Side-effect-bounded, mirror of
 * `runMonthlyDebriefOverdueAlert` / `runCalendarOverdueAlert` :
 *   - ALWAYS one PII-free heartbeat audit (`cron.onboarding_profile_overdue.scan`)
 *     consumed by `lib/system/health.ts` — emitted every run, so an overdue
 *     profile never blinds the monitor.
 *   - overdue > 0 → admin email (best-effort, `WEEKLY_REPORT_RECIPIENT`) +
 *     `reportWarning`. Email failure degrades to the Sentry warning, never
 *     throws back into the cron.
 *
 * Anti-spam by cadence (daily) : ≤ 1 nudge/day while overdue, stops the moment
 * the onboarding batch is run. It never drives Claude — count + email only.
 */
export async function runOnboardingProfileOverdueAlert(
  options: { now?: Date } = {},
): Promise<OnboardingProfileOverdueAlertResult> {
  const scan = await scanOverdueOnboardingProfiles(options);

  let emailOutcome: OverdueAlertEmailOutcome = 'not_attempted';

  if (scan.overdueCount > 0) {
    reportWarning('cron.onboarding-profile-overdue', 'onboarding_profiles_overdue', {
      overdueCount: scan.overdueCount,
      oldestCompletedAt: scan.oldestCompletedAt,
    });

    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      try {
        const { delivered } = await sendOnboardingProfileOverdueAlertEmail({
          to: recipient,
          overdueCount: scan.overdueCount,
          oldestCompletedAt: scan.oldestCompletedAt,
        });
        emailOutcome = delivered ? 'sent' : 'skipped';
      } catch (err) {
        emailOutcome = 'failed';
        reportWarning('cron.onboarding-profile-overdue', 'admin_email_failed', {
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
  }

  await logAudit({
    action: 'cron.onboarding_profile_overdue.scan',
    metadata: {
      overdueCount: scan.overdueCount,
      oldestCompletedAt: scan.oldestCompletedAt,
      withinGrace: scan.withinGrace,
      alerted: scan.overdueCount > 0,
      emailOutcome,
      scannedAt: scan.scannedAt,
    },
  });

  return { ...scan, alerted: scan.overdueCount > 0, emailOutcome };
}
