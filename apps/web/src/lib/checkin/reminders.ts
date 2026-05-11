import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { enqueueCheckinReminder } from '@/lib/notifications/enqueue';

import {
  isEveningReminderDue,
  isMorningReminderDue,
  localDateOf,
  parseLocalDate,
} from './timezone';

/**
 * Cron-driven helper that scans active members and enqueues missing
 * check-in reminders (J5, SPEC §7.4).
 *
 * Wired in `app/api/cron/checkin-reminders/route.ts` and meant to be hit by
 * the Hetzner crontab every ~15 minutes.
 *
 * J5 audit fixes (BLOCKERS B2 + B3):
 *   - Single early-return when neither window is due (V1 = single TZ).
 *   - **Bulk** fetch existing checkins (1 query, not N) when there's anyone
 *     to consider, so the scan stays O(1) round-trips on the DB hot path
 *     instead of O(users).
 *   - Use the canonical `parseLocalDate` helper everywhere (was using
 *     hand-built `new Date('...T00:00:00.000Z')` in one place).
 *   - Race-safe enqueue idempotency now lives at the DB index level
 *     (notification_queue_pending_checkin_dedup), so the JS-side
 *     "did anything actually insert?" answer comes back deterministically.
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

  // Fast path — V1 ships single-TZ (Europe/Paris). If neither morning nor
  // evening window is due, skip the entire scan. When V2 introduces per-user
  // timezones, this short-circuit becomes a per-TZ-bucket aware probe.
  const probeTz = 'Europe/Paris';
  const morningDueProbe = isMorningReminderDue(now, probeTz);
  const eveningDueProbe = isEveningReminderDue(now, probeTz);
  if (!morningDueProbe && !eveningDueProbe) {
    await logAudit({
      action: 'cron.checkin_reminders.scan',
      metadata: {
        scannedUsers: 0,
        enqueuedMorning: 0,
        enqueuedEvening: 0,
        skipped: 0,
        ranAt: result.ranAt,
        reason: 'out_of_window',
      },
    });
    return result;
  }

  // Active members only. Admins are excluded (cf. SPEC posture: members are
  // the audience, admins self-onboard if they want).
  const users: ScanCandidate[] = await db.user.findMany({
    where: {
      status: 'active',
      role: 'member',
      ...(options.userIds?.length ? { id: { in: options.userIds } } : {}),
    },
    select: { id: true, timezone: true },
  });

  if (users.length === 0) {
    await logAudit({
      action: 'cron.checkin_reminders.scan',
      metadata: { ...result, reason: 'no_eligible_users' },
    });
    return result;
  }

  // Single bulk fetch of today's checkins for all candidates. We compute
  // `today` per user (in case timezones differ in V2), but in V1 they all
  // share Europe/Paris — so we collapse to a single per-TZ today.
  const todayByTz = new Map<string, string>();
  const todayLookup = (tz: string): string => {
    const cached = todayByTz.get(tz);
    if (cached) return cached;
    const fresh = localDateOf(now, tz);
    todayByTz.set(tz, fresh);
    return fresh;
  };

  // Pre-compute due windows + today per user — so the lookup is one map
  // per user with no DB call.
  const userMeta = users.map((u) => {
    const tz = u.timezone || 'Europe/Paris';
    return {
      id: u.id,
      tz,
      today: todayLookup(tz),
      morningDue: isMorningReminderDue(now, tz),
      eveningDue: isEveningReminderDue(now, tz),
    };
  });

  const dueUserIds = userMeta.filter((u) => u.morningDue || u.eveningDue).map((u) => u.id);
  if (dueUserIds.length === 0) {
    result.scannedUsers = users.length;
    result.skipped = users.length;
    await logAudit({
      action: 'cron.checkin_reminders.scan',
      metadata: { ...result, reason: 'no_users_in_window' },
    });
    return result;
  }

  // Bulk lookup of today's checkins for ALL due users in 1 round-trip.
  // We pass a list of `Date` (parsed via `parseLocalDate`) so Prisma writes
  // the canonical UTC-midnight values that match `@db.Date`.
  const dates = Array.from(new Set(userMeta.map((u) => u.today))).map((d) => parseLocalDate(d));
  const existingRows = await db.dailyCheckin.findMany({
    where: {
      userId: { in: dueUserIds },
      date: { in: dates },
    },
    select: { userId: true, date: true, slot: true },
  });

  // Index by (userId, dateString, slot) for O(1) lookup in the per-user loop.
  const filledKey = (uid: string, date: string, slot: 'morning' | 'evening') =>
    `${uid}|${date}|${slot}`;
  const filled = new Set(
    existingRows.map((r) => filledKey(r.userId, r.date.toISOString().slice(0, 10), r.slot)),
  );

  // Per-user enqueue. The actual enqueue function is race-safe (P2002 catch),
  // so concurrent scans converge on the same row count.
  for (const user of userMeta) {
    result.scannedUsers += 1;
    if (!user.morningDue && !user.eveningDue) {
      result.skipped += 1;
      continue;
    }
    let didEnqueue = false;
    if (user.morningDue && !filled.has(filledKey(user.id, user.today, 'morning'))) {
      const id = await enqueueCheckinReminder(user.id, { slot: 'morning', date: user.today });
      if (id) {
        result.enqueuedMorning += 1;
        didEnqueue = true;
      }
    }
    if (user.eveningDue && !filled.has(filledKey(user.id, user.today, 'evening'))) {
      const id = await enqueueCheckinReminder(user.id, { slot: 'evening', date: user.today });
      if (id) {
        result.enqueuedEvening += 1;
        didEnqueue = true;
      }
    }
    if (!didEnqueue) result.skipped += 1;
  }

  // Single audit row per scan — heartbeat without spamming the audit log.
  await logAudit({
    action: 'cron.checkin_reminders.scan',
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
