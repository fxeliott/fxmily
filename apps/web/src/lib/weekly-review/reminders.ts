import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { currentParisWeekStart } from '@/lib/calendar/week';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { enqueueWeeklyReviewReminderNotification } from '@/lib/notifications/enqueue';

/**
 * Cron-driven helper that scans active members and enqueues a gentle "ta revue
 * de la semaine t'attend" reminder for those who were eligible this week but
 * haven't written their weekly review yet (REFLECT V1.8, J2 notification).
 *
 * Wired in `app/api/cron/weekly-review-reminders/route.ts`, meant to be hit by
 * the Hetzner crontab once a week (Sunday 09:00 Paris).
 *
 * Carbon of `runCheckinReminderScan` (J5) on the essentials:
 *   - **Active members only** (`status: 'active', role: 'member'`) — admins are
 *     excluded (they self-onboard if they want the nudge).
 *   - **Bulk** fetch this week's existing reviews in ONE query (not N), so the
 *     scan stays O(1) DB round-trips on the hot path — supports the "milliers de
 *     membres" SPEC target.
 *   - **`enqueueWeeklyReviewReminderNotification` owns the "max 1/week" dedup**
 *     (application-level, keyed on user + type + `payload.weekStart`), so a benign
 *     re-run of the same weekly scan converges on the existing row.
 *   - **1 audit row per scan** (`cron.weekly_review_reminders.scan`), counters
 *     only — a clean PII-free heartbeat for `health.ts`, never one row per user.
 */

export interface WeeklyReviewReminderScanResult {
  /** Active members considered this scan. */
  scannedUsers: number;
  /** Members with NO weekly review for the current Paris week. */
  withoutReview: number;
  /** Reminders successfully enqueued (or deduped to an existing pending row). */
  enqueued: number;
  /**
   * Enqueue attempts that genuinely FAILED (a `null` id from the best-effort
   * enqueue). Surfaced in the heartbeat so `health.ts` can escalate the cron
   * green→amber instead of hiding a failed reminder. Mirrors the J5 A-Z fix.
   */
  errors: number;
  /** Monday `YYYY-MM-DD` (Europe/Paris) of the week this scan targeted. */
  weekStart: string;
  /** Wall-clock at the moment the scan started, ISO 8601. */
  ranAt: string;
}

/**
 * Run a single weekly-review reminder scan. Pure-ish: takes `now` for
 * testability (defaults to the wall clock) and always writes exactly one audit
 * heartbeat before returning.
 */
export async function runWeeklyReviewReminderScan(
  now: Date = new Date(),
): Promise<WeeklyReviewReminderScanResult> {
  const weekStart = currentParisWeekStart(now);
  const result: WeeklyReviewReminderScanResult = {
    scannedUsers: 0,
    withoutReview: 0,
    enqueued: 0,
    errors: 0,
    weekStart,
    ranAt: now.toISOString(),
  };

  // Active members only. Admins are excluded (cf. J5 posture: members are the
  // audience for the nudge).
  const users = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true },
  });
  result.scannedUsers = users.length;

  if (users.length === 0) {
    await logAudit({
      action: 'cron.weekly_review_reminders.scan',
      metadata: { ...result, reason: 'no_eligible_users' },
    });
    return result;
  }

  const activeIds = users.map((u) => u.id);

  // Single bulk fetch of this week's reviews for all candidates. `weekStart` is
  // an `@db.Date` UTC-midnight column, so convert the string via `parseLocalDate`
  // (same as `getWeeklyReview` in weekly-review/service.ts) — never a raw
  // `new Date('...')` which would drift a day across timezones.
  const existingReviews = await db.weeklyReview.findMany({
    where: {
      userId: { in: activeIds },
      weekStart: parseLocalDate(weekStart),
    },
    select: { userId: true },
  });
  const reviewedIds = new Set(existingReviews.map((r) => r.userId));

  // Diff in memory → members WITHOUT a review this week get a reminder. The
  // enqueue is race-safe + weekly-deduped, so a re-run converges on the same
  // row count.
  for (const userId of activeIds) {
    if (reviewedIds.has(userId)) continue;
    result.withoutReview += 1;
    const id = await enqueueWeeklyReviewReminderNotification(userId, { weekStart });
    if (id) result.enqueued += 1;
    else result.errors += 1;
  }

  // Single audit row per scan — heartbeat without spamming the audit log.
  await logAudit({
    action: 'cron.weekly_review_reminders.scan',
    metadata: {
      scannedUsers: result.scannedUsers,
      withoutReview: result.withoutReview,
      enqueued: result.enqueued,
      errors: result.errors,
      weekStart: result.weekStart,
      ranAt: result.ranAt,
    },
  });

  return result;
}
