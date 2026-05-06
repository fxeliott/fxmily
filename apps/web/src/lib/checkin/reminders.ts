import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { enqueueCheckinReminder } from '@/lib/notifications/enqueue';

import { isEveningReminderDue, isMorningReminderDue, localDateOf } from './timezone';

/**
 * Cron-driven helper that scans active members and enqueues missing
 * check-in reminders (J5, SPEC §7.4).
 *
 * Wired in `app/api/cron/checkin-reminders/route.ts` and meant to be hit by
 * the Hetzner crontab every ~15 minutes. Skips a member when:
 *   - their local time is outside the morning (07:30–09:00) AND evening
 *     (20:30–22:00) windows; OR
 *   - the matching DailyCheckin row already exists for today.
 *
 * The dispatcher (J9) then walks `notification_queue` rows with status
 * `pending` and pushes via Web Push.
 */

export interface ReminderScanResult {
  scannedUsers: number;
  enqueuedMorning: number;
  enqueuedEvening: number;
  skipped: number;
  /** Wall-clock at the moment the scan started, ISO 8601. */
  ranAt: string;
}

interface ScanCandidate {
  id: string;
  timezone: string;
}

/**
 * Run a single reminder scan. Pure-ish: takes `now` for testability and a
 * `userQuery` knob for tests/CLI runs (defaults to all active members).
 */
export async function runCheckinReminderScan(
  now: Date = new Date(),
  options: { userIds?: string[] } = {},
): Promise<ReminderScanResult> {
  const result: ReminderScanResult = {
    scannedUsers: 0,
    enqueuedMorning: 0,
    enqueuedEvening: 0,
    skipped: 0,
    ranAt: now.toISOString(),
  };

  // Filter candidates: active members only. We avoid scoring admins
  // (they can self-onboard if they want; not the target audience).
  const users: ScanCandidate[] = await db.user.findMany({
    where: {
      status: 'active',
      role: 'member',
      ...(options.userIds && options.userIds.length > 0 ? { id: { in: options.userIds } } : {}),
    },
    select: { id: true, timezone: true },
  });

  for (const user of users) {
    result.scannedUsers += 1;
    const tz = user.timezone || 'Europe/Paris';
    const due = {
      morning: isMorningReminderDue(now, tz),
      evening: isEveningReminderDue(now, tz),
    };

    if (!due.morning && !due.evening) {
      result.skipped += 1;
      continue;
    }

    const today = localDateOf(now, tz);
    // Pull whatever check-ins already exist today for this user.
    const existing = await db.dailyCheckin.findMany({
      where: { userId: user.id, date: new Date(`${today}T00:00:00.000Z`) },
      select: { slot: true },
    });
    const filled = new Set(existing.map((r) => r.slot));

    let didEnqueue = false;
    if (due.morning && !filled.has('morning')) {
      const id = await enqueueCheckinReminder(user.id, { slot: 'morning', date: today });
      if (id) {
        result.enqueuedMorning += 1;
        didEnqueue = true;
      }
    }
    if (due.evening && !filled.has('evening')) {
      const id = await enqueueCheckinReminder(user.id, { slot: 'evening', date: today });
      if (id) {
        result.enqueuedEvening += 1;
        didEnqueue = true;
      }
    }
    if (!didEnqueue) result.skipped += 1;
  }

  // Single audit row per scan (not per user) — keeps the audit table tidy
  // and gives Eliot a heartbeat row in the admin dashboard later.
  await logAudit({
    action: 'checkin.reminder.scan',
    metadata: {
      scannedUsers: result.scannedUsers,
      enqueuedMorning: result.enqueuedMorning,
      enqueuedEvening: result.enqueuedEvening,
      skipped: result.skipped,
      ranAt: result.ranAt,
    },
  });

  return result;
}
