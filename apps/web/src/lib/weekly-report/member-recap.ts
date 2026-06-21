import 'server-only';

import type { WeeklyRecapCounters } from '@/components/progression/weekly-recap-card';

import { buildWeeklySnapshot } from './builder';
import { loadWeeklySliceForUser } from './loader';

/**
 * Member-facing weekly recap data source (S14).
 *
 * Reuses the EXACT aggregation that feeds the coach/admin email — the loader
 * (`loadWeeklySliceForUser`) + the pure builder (`buildWeeklySnapshot`) — to
 * produce the member's own `WeeklySnapshot.counters`, for BOTH the current
 * reporting week and the previous full week. The card's pure aggregator
 * (`computeWeeklyRecap`) then derives the week-vs-week deltas from these two
 * counter slices. No new heavy query, no new table — the two loads are the
 * same ~6-query slice the cron already runs once per member per week.
 *
 * Posture §2 : counts/rates only, zero P&L surfaced (the builder's counters
 * slice is count-only by construction). `null` on a metric means "not measured"
 * — never coerced to 0 by the consumer.
 *
 * Failure-safe : if a slice is unavailable (inactive member, or the previous
 * week could not be loaded), the corresponding side is `null` and the card
 * gracefully drops the delta rather than fabricating one.
 */
export interface MemberWeeklyRecapData {
  current: WeeklyRecapCounters;
  previous: WeeklyRecapCounters | null;
}

/** Project the full snapshot counters down to the 4 fields the card consumes. */
function toRecapCounters(counters: {
  tradesTotal: number;
  planRespectRate: number | null;
  streakDays: number;
  eveningCheckinsCount: number;
}): WeeklyRecapCounters {
  return {
    tradesTotal: counters.tradesTotal,
    planRespectRate: counters.planRespectRate,
    streakDays: counters.streakDays,
    eveningCheckinsCount: counters.eveningCheckinsCount,
  };
}

/**
 * Load the member's current + previous week recap counters.
 *
 * Returns `null` when the member is inactive / has no current slice — the
 * caller then renders nothing (the page already gates auth). The previous week
 * is best-effort: a missing previous slice yields `previous: null`, which the
 * card reads as "first measured week, no delta".
 *
 * @param now injectable clock (defaults to `new Date()`) — kept for parity with
 *            the rest of the weekly-report pipeline and to keep this testable.
 */
export async function getMemberWeeklyRecap(
  userId: string,
  now: Date = new Date(),
): Promise<MemberWeeklyRecapData | null> {
  const [currentSlice, previousSlice] = await Promise.all([
    loadWeeklySliceForUser(userId, { now, previousFullWeek: false }),
    loadWeeklySliceForUser(userId, { now, previousFullWeek: true }),
  ]);

  if (currentSlice === null) {
    return null;
  }

  const current = toRecapCounters(buildWeeklySnapshot(currentSlice.builderInput).counters);
  const previous =
    previousSlice === null
      ? null
      : toRecapCounters(buildWeeklySnapshot(previousSlice.builderInput).counters);

  return { current, previous };
}
