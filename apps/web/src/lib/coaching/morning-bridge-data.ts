import 'server-only';

import { getOffDaySet, isOffDay } from '@/lib/checkin/off-days';
import { getCheckin, listRecentCheckinDays } from '@/lib/checkin/service';
import {
  localDateOf,
  safeTimeZone,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

import { buildMorningBridge, type MorningBridge } from './morning-bridge';
import type { CoachingRegister } from './trade-echo';

/**
 * Tour 11 — server seam for the dashboard MORNING BRIDGE + the account-age fact
 * the journey milestone needs. Keeps every new DB read in the coaching module
 * (never in `page.tsx`), mirroring how `trade-echo` is fed by the journal page.
 *
 * FIREWALL §21.5: reads the member's OWN check-ins only; the `register` is
 * passed in already-derived (via `echoProfileDims` in the page), NEVER
 * `weakSignals` or raw AI blobs. All reads are userId-scoped and indexed.
 */

export interface DashboardMorningContext {
  /** The built bridge (null when it should not show — see `buildMorningBridge`). */
  bridge: MorningBridge | null;
  /** ISO instant of account creation, for the first-month journey milestone. */
  createdAt: string | null;
}

/**
 * Assemble the morning bridge and load the account-creation instant.
 *
 * The bridge only reads DB when it may actually show: OUTSIDE the morning window
 * we skip the extra check-in reads entirely (the bridge is null off-morning).
 * The member's `createdAt` is always read (one tiny indexed lookup) because the
 * journey milestone needs it regardless of the hour.
 *
 * `localHour` / `now` are derived from the request clock + the member's TZ so the
 * whole thing is deterministic and the pure builder stays unit-testable.
 */
export async function getDashboardMorningContext(
  userId: string,
  timezone: string,
  register: CoachingRegister | null,
  now: Date = new Date(),
): Promise<DashboardMorningContext> {
  // Fence a non-IANA legacy tz before it reaches Intl (would throw a RangeError
  // and take the dashboard down). The date CALCULATIONS below keep their own
  // internal UTC fallback (localDateOf/shiftLocalDate) — untouched on purpose.
  const localHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: safeTimeZone(timezone),
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );

  // Account age fact — always needed by the journey milestone. One indexed read.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  const createdAt = user?.createdAt.toISOString() ?? null;

  // Off-morning: the bridge is null anyway → don't pay for the check-in reads.
  const MORNING_END_HOUR = 12;
  if (!(localHour >= 0 && localHour < MORNING_END_HOUR)) {
    return { bridge: null, createdAt };
  }

  const today = localDateOf(now, timezone);
  const yesterday = shiftLocalDate(today, -1);
  const windowStart = shiftLocalDate(today, -(60 - 1));

  const [yesterdayEveningRow, recentDays, offCtx] = await Promise.all([
    getCheckin(userId, yesterday, 'evening'),
    // 60-day window (same as the streak walker) → most-recent check-in date for
    // the return-after-absence branch. Not deduped with getStreak (different fn),
    // but a single cheap indexed read on a small cohort.
    listRecentCheckinDays(userId, today, 60),
    // Tour 14 — off-day context over the same window, so the absence count steps
    // OVER off days: a Monday morning after a weekend the member keeps off reads
    // "1 day" (Friday → Monday, weekend stepped over), not "3 days d'absence".
    getOffDaySet(userId, windowStart, today),
  ]);

  // Whole days since the member's most recent check-in (any slot), or null when
  // they have never checked in. `recentDays` is sorted newest-first by the service.
  // Tour 14 — count only the ACTIVE (non-off) days between the last check-in and
  // today, so an off weekend never inflates the absence (§31.2 — a chosen rest
  // is not an absence).
  const lastDate = recentDays[0]?.date ?? null;
  const daysSinceLastCheckin =
    lastDate === null ? null : activeDaysSince(lastDate, today, (d) => isOffDay(d, offCtx));

  const bridge = buildMorningBridge({
    localHour,
    daysSinceLastCheckin,
    yesterdayEvening: yesterdayEveningRow
      ? {
          intentionKept: yesterdayEveningRow.intentionKept,
          planRespectedToday: yesterdayEveningRow.planRespectedToday,
          stressScore: yesterdayEveningRow.stressScore,
        }
      : null,
    coachingRegister: register,
  });

  return { bridge, createdAt };
}

/**
 * Tour 14 — number of ACTIVE (non-off) days strictly after `lastDate` up to and
 * including `today`, so an off day the member never owed a check-in on does not
 * count as an absence (a Monday morning after an off weekend reads "1", not "3").
 *
 * Semantics preserved vs the old raw diff:
 *   - `lastDate === today` → 0 (checked in today — the bridge is null anyway);
 *   - each civil day in `(lastDate, today]` counts 1 unless it is off.
 * Bounded by the 60-day service window, so the walk is short. `isOff` is the
 * pure predicate (string-keyed), no DB inside.
 */
function activeDaysSince(
  lastDate: LocalDateString,
  today: LocalDateString,
  isOff: (date: LocalDateString) => boolean,
): number {
  let count = 0;
  let cursor = shiftLocalDate(lastDate, 1);
  // Walk forward day by day; ISO strings compare lexicographically as calendar
  // dates, so the loop terminates at `today` inclusive.
  while (cursor <= today) {
    if (!isOff(cursor)) count += 1;
    cursor = shiftLocalDate(cursor, 1);
  }
  return count;
}
