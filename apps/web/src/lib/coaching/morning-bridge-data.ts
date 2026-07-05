import 'server-only';

import { getCheckin, listRecentCheckinDays } from '@/lib/checkin/service';
import { localDateOf, safeTimeZone, shiftLocalDate } from '@/lib/checkin/timezone';
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

  const [yesterdayEveningRow, recentDays] = await Promise.all([
    getCheckin(userId, yesterday, 'evening'),
    // 60-day window (same as the streak walker) → most-recent check-in date for
    // the return-after-absence branch. Not deduped with getStreak (different fn),
    // but a single cheap indexed read on a small cohort.
    listRecentCheckinDays(userId, today, 60),
  ]);

  // Whole days since the member's most recent check-in (any slot), or null when
  // they have never checked in. `recentDays` is sorted newest-first by the service.
  const lastDate = recentDays[0]?.date ?? null;
  const daysSinceLastCheckin = lastDate === null ? null : daysBetweenLocalDates(lastDate, today);

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
 * Whole days between two `YYYY-MM-DD` local dates (b - a). Both are UTC-midnight
 * semantics, so a plain UTC-ms diff is exact (DST-safe on the calendar level).
 */
function daysBetweenLocalDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aMs = Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1);
  const bMs = Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}
