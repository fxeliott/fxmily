import 'server-only';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { enqueueMindsetCheckNotification } from '@/lib/notifications/enqueue';

import { currentParisWeekStart } from './week';

/**
 * V1.5 — weekly mindset-check reminder scan (SPEC §27.2/§27.4).
 *
 * Wired in `app/api/cron/mindset-check-reminders/route.ts`, hit by the
 * Hetzner crontab once a week (Monday — the day the new mindset week opens).
 *
 * DELIBERATE divergence from `checkin/reminders.ts` (which it mirrors): the
 * check-in scan runs every 15 min inside tight 90-min windows, so it needs a
 * time-window probe + a DB dedup index. The mindset reminder is WEEKLY and
 * single-instance — running it twice on the same Monday must be a no-op, and
 * the idempotency is APPLICATION-level: a member is skipped if they already
 * submitted this week's check OR already have a pending `mindset_check_ready`
 * nudge for this `weekStart`. No tight time-window, no dedup index needed —
 * the weekly cadence + the skip logic IS the safety. Gentle, anti-FOMO,
 * non-culpabilisant (canon §7.9/§23, SPEC §27.2). PII-free, §21.5/§27.7-safe:
 * reads ONLY `db.mindsetCheck` / `db.user` / `db.notificationQueue`, touches
 * no real-edge object, feeds nothing into scoring/engagement/triggers.
 */

export interface MindsetReminderScanResult {
  scannedUsers: number;
  enqueued: number;
  skipped: number;
  /**
   * Eligible members whose weekly-nudge enqueue genuinely FAILED (null id).
   * Surfaced in the heartbeat so health.ts escalates the WEEKLY cron
   * green→amber instead of hiding a failed nudge in `skipped`. A-Z fix.
   */
  errors: number;
  /** Monday `YYYY-MM-DD` (Europe/Paris) the nudge is for. */
  weekStart: string;
  /** Wall-clock at the moment the scan started, ISO 8601. */
  ranAt: string;
}

function pendingPayloadWeekStart(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const v = (payload as Record<string, unknown>).weekStart;
  return typeof v === 'string' ? v : null;
}

/**
 * Run a single weekly reminder scan. `now` is injectable for tests/CLI;
 * `userIds` narrows the cohort (tests/targeted re-run).
 */
export async function runMindsetCheckReminderScan(
  now: Date = new Date(),
  options: { userIds?: string[] } = {},
): Promise<MindsetReminderScanResult> {
  const weekStart = currentParisWeekStart(now);
  const result: MindsetReminderScanResult = {
    scannedUsers: 0,
    enqueued: 0,
    skipped: 0,
    errors: 0,
    weekStart,
    ranAt: now.toISOString(),
  };

  // Active members only (admins excluded — members are the audience, canon).
  const users = await db.user.findMany({
    where: {
      status: 'active',
      role: 'member',
      ...(options.userIds?.length ? { id: { in: options.userIds } } : {}),
    },
    select: { id: true },
  });

  if (users.length === 0) {
    await logAudit({
      action: 'cron.mindset_check_reminders.scan',
      metadata: { ...result, reason: 'no_eligible_users' },
    });
    return result;
  }

  const userIds = users.map((u) => u.id);
  const weekStartDb = parseLocalDate(weekStart);

  // Two bulk lookups (O(1) round-trips, never O(users)):
  //  1. who already submitted THIS week's mindset check;
  //  2. who already has a pending `mindset_check_ready` push for THIS week.
  const [alreadyChecked, pendingNudges] = await Promise.all([
    db.mindsetCheck.findMany({
      where: { userId: { in: userIds }, weekStart: weekStartDb },
      select: { userId: true },
    }),
    db.notificationQueue.findMany({
      where: { userId: { in: userIds }, type: 'mindset_check_ready', status: 'pending' },
      select: { userId: true, payload: true },
    }),
  ]);

  const submitted = new Set(alreadyChecked.map((r) => r.userId));
  const nudgedThisWeek = new Set(
    pendingNudges
      .filter((n) => pendingPayloadWeekStart(n.payload) === weekStart)
      .map((n) => n.userId),
  );

  for (const userId of userIds) {
    result.scannedUsers += 1;
    if (submitted.has(userId) || nudgedThisWeek.has(userId)) {
      result.skipped += 1;
      continue;
    }
    // Eligible member (not submitted, not nudged) → a null id is a genuine
    // enqueue failure, NOT a skip. Tally it as an error so the weekly cron
    // can't show green when nudges silently failed to enqueue. A-Z fix.
    const id = await enqueueMindsetCheckNotification(userId, { weekStart });
    if (id) result.enqueued += 1;
    else result.errors += 1;
  }

  // Single audit heartbeat per scan (canon — no per-user spam).
  await logAudit({
    action: 'cron.mindset_check_reminders.scan',
    metadata: {
      scannedUsers: result.scannedUsers,
      enqueued: result.enqueued,
      skipped: result.skipped,
      errors: result.errors,
      weekStart: result.weekStart,
      ranAt: result.ranAt,
    },
  });

  return result;
}
