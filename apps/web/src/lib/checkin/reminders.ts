import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { enqueueCheckinReminder } from '@/lib/notifications/enqueue';

import { isOffDay, type OffDayContext } from './off-days';
import { computeStreak, type CheckinDay, type CheckinSlotName } from './streak';
import {
  isEveningReminderDue,
  isMorningReminderDue,
  localDateOf,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
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

/**
 * Trailing window (days) of check-ins fetched per scan. Sized so the same single
 * bulk query that gates today's `filled` also yields enough history for a correct
 * streak (action 2). 40 covers the longest celebrated milestone (30) with slack
 * while staying a cheap, index-served range scan on the ≤30-member V1 cohort.
 */
const STREAK_WINDOW_DAYS = 40;

export interface ReminderScanResult {
  scannedUsers: number;
  enqueuedMorning: number;
  enqueuedEvening: number;
  skipped: number;
  /**
   * Tour 14 — subset of `skipped` whose reason is an off day (weekend off or an
   * explicit declaration): a "pont" suppression, never a failure. Surfaced in
   * the heartbeat so an operator can tell a calm all-off weekend (many
   * off-day skips, 0 errors) apart from a silent breakage. The health check keys
   * red/amber on `errors`, so an all-off scan stays green.
   */
  offDaySkipped: number;
  /**
   * Due-but-unfilled slots whose enqueue genuinely FAILED (a `null` id that is
   * NOT the P2002 no-op). Surfaced in the heartbeat so health.ts escalates the
   * cron green→amber instead of hiding a failed reminder in `skipped`. A-Z fix.
   */
  errors: number;
  /** Wall-clock at the moment the scan started, ISO 8601. */
  ranAt: string;
}

interface ScanCandidate {
  id: string;
  timezone: string;
  /** Tour 14 — weekend off preference (drives the off-day pont). */
  weekendsOff: boolean;
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
    offDaySkipped: 0,
    errors: 0,
    ranAt: now.toISOString(),
  };

  // Active members only. Admins are excluded (cf. SPEC posture: members are
  // the audience, admins self-onboard if they want).
  const users: ScanCandidate[] = await db.user.findMany({
    where: {
      status: 'active',
      role: 'member',
      ...(options.userIds?.length ? { id: { in: options.userIds } } : {}),
    },
    select: { id: true, timezone: true, weekendsOff: true },
  });

  if (users.length === 0) {
    await logAudit({
      action: 'cron.checkin_reminders.scan',
      metadata: { ...result, reason: 'no_eligible_users' },
    });
    return result;
  }

  // Per-TZ-bucket fast path (F2 — members can live in different timezones).
  // A single Europe/Paris probe would SKIP a member whose LOCAL 07:30/20:30
  // window is due while Paris is out-of-window (and conversely fire a scan a
  // member doesn't need). We probe each DISTINCT timezone present in the cohort
  // and short-circuit only when NO bucket is due — preserving the early return
  // before the heavier per-day checkin bulk fetch + enqueue loop.
  const distinctTzs = new Set(users.map((u) => u.timezone || 'Europe/Paris'));
  const anyWindowDue = [...distinctTzs].some(
    (tz) => isMorningReminderDue(now, tz) || isEveningReminderDue(now, tz),
  );
  if (!anyWindowDue) {
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

  // Single bulk fetch of today's checkins for all candidates. `today` is
  // computed per user in their own timezone (F2: members can differ), memoised
  // per distinct TZ so the work collapses to one `localDateOf` per bucket.
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
      weekendsOff: u.weekendsOff,
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

  // Bulk lookup of due users' checkins in 1 round-trip. The window is widened
  // from "today" to the trailing STREAK_WINDOW_DAYS so the SAME single query
  // feeds BOTH the today `filled` gate AND the per-member streak used for the
  // calm streak-aware reminder copy (action 2). Still O(1) round-trips — the
  // streak is computed in memory from these rows, never one query per member.
  const lowerBoundDate = Array.from(new Set(userMeta.map((u) => u.today)))
    .map((d) => shiftLocalDate(d, -(STREAK_WINDOW_DAYS - 1)))
    .reduce((min, d) => (d < min ? d : min));
  const existingRows = await db.dailyCheckin.findMany({
    where: {
      userId: { in: dueUserIds },
      date: { gte: parseLocalDate(lowerBoundDate) },
    },
    select: { userId: true, date: true, slot: true },
  });

  // Tour 14 — bulk-fetch the EXPLICIT off days for the due members over the SAME
  // trailing window as the check-ins, in ONE query. Combined with each member's
  // `weekendsOff` flag (already on `userMeta`), this drives both the streak pont
  // (unfilled off days are stepped over) and the enqueue filter (a member whose
  // LOCAL today is off gets no reminder). Still O(1) round-trips on the cron.
  const offRows = await db.memberOffDay.findMany({
    where: {
      userId: { in: dueUserIds },
      date: { gte: parseLocalDate(lowerBoundDate) },
    },
    select: { userId: true, date: true },
  });
  const explicitOffByUser = new Map<string, Set<LocalDateString>>();
  for (const r of offRows) {
    const dateStr = r.date.toISOString().slice(0, 10);
    const set = explicitOffByUser.get(r.userId);
    if (set) set.add(dateStr);
    else explicitOffByUser.set(r.userId, new Set([dateStr]));
  }
  const offCtxFor = (userId: string, weekendsOff: boolean): OffDayContext => ({
    weekendsOff,
    explicitDates: explicitOffByUser.get(userId) ?? new Set<LocalDateString>(),
  });

  // Index by (userId, dateString, slot) for O(1) lookup in the per-user loop.
  // The `filled` gate only cares about TODAY, so we key the today rows; the
  // per-member streak days are accumulated separately over the whole window.
  const filledKey = (uid: string, date: string, slot: 'morning' | 'evening') =>
    `${uid}|${date}|${slot}`;
  const filled = new Set<string>();
  // Per-member map of local-date → slots filed, fed to `computeStreak`.
  const daysByUser = new Map<string, Map<string, Set<CheckinSlotName>>>();
  for (const r of existingRows) {
    const dateStr = r.date.toISOString().slice(0, 10);
    const slot = r.slot as CheckinSlotName;
    filled.add(filledKey(r.userId, dateStr, slot));
    let byDate = daysByUser.get(r.userId);
    if (!byDate) {
      byDate = new Map();
      daysByUser.set(r.userId, byDate);
    }
    const slots = byDate.get(dateStr);
    if (slots) slots.add(slot);
    else byDate.set(dateStr, new Set([slot]));
  }

  /**
   * Current streak for a member, computed in memory from the pre-fetched window.
   * `computeStreak` is pure (already used elsewhere) — reused here so the copy
   * and the app agree on what "streak" means. Anchored on the member's OWN local
   * `today` (F2 — members can live in different timezones). Tour 14 — the
   * off-day pont is threaded through so an off weekend never breaks the streak
   * line in the reminder copy (same semantics as the app's `getStreak`).
   */
  const streakFor = (userId: string, today: string, offCtx: OffDayContext): number => {
    const byDate = daysByUser.get(userId);
    if (!byDate) return 0;
    const days: CheckinDay[] = [];
    for (const [date, slots] of byDate) days.push({ date, slots: [...slots] });
    return computeStreak(days, today, (d) => isOffDay(d, offCtx));
  };

  // Per-user enqueue. The actual enqueue function is race-safe (P2002 catch),
  // so concurrent scans converge on the same row count.
  for (const user of userMeta) {
    result.scannedUsers += 1;
    if (!user.morningDue && !user.eveningDue) {
      result.skipped += 1;
      continue;
    }
    // Tour 14 — a member whose LOCAL today is an off day gets NO reminder: the
    // off day is a "pont" (no pressure, no nag). Counted as `skipped` with the
    // reason surfaced in the heartbeat, NOT `errors`, so the cron stays green
    // when everyone is off (e.g. a weekend). A member who nonetheless files a
    // check-in on an off day is unaffected — this only suppresses the reminder.
    const offCtx = offCtxFor(user.id, user.weekendsOff);
    if (isOffDay(user.today, offCtx)) {
      result.skipped += 1;
      result.offDaySkipped += 1;
      continue;
    }
    // `attempted` = at least one due+unfilled slot tried to enqueue. A member
    // with nothing to enqueue (both filled / not due) is a legitimate `skipped`;
    // a member whose attempt returned a null id is an `errors` (NOT a skip) —
    // that's the whole point of the A-Z fix, so a failed reminder can't hide.
    let attempted = false;
    // Streak computed once per member (not per slot) from the pre-fetched window.
    // The off-day context (already resolved for the filter above) is reused so
    // the streak line steps over the member's off days.
    const streak = streakFor(user.id, user.today, offCtx);
    if (user.morningDue && !filled.has(filledKey(user.id, user.today, 'morning'))) {
      attempted = true;
      const id = await enqueueCheckinReminder(user.id, {
        slot: 'morning',
        date: user.today,
        streak,
      });
      if (id) result.enqueuedMorning += 1;
      else result.errors += 1;
    }
    if (user.eveningDue && !filled.has(filledKey(user.id, user.today, 'evening'))) {
      attempted = true;
      const id = await enqueueCheckinReminder(user.id, {
        slot: 'evening',
        date: user.today,
        streak,
      });
      if (id) result.enqueuedEvening += 1;
      else result.errors += 1;
    }
    if (!attempted) result.skipped += 1;
  }

  // Single audit row per scan — heartbeat without spamming the audit log.
  await logAudit({
    action: 'cron.checkin_reminders.scan',
    metadata: {
      scannedUsers: result.scannedUsers,
      enqueuedMorning: result.enqueuedMorning,
      enqueuedEvening: result.enqueuedEvening,
      skipped: result.skipped,
      offDaySkipped: result.offDaySkipped,
      errors: result.errors,
      ranAt: result.ranAt,
    },
  });

  return result;
}
