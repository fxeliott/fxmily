import { crossedMilestone, type StreakMilestone } from './streak';

/**
 * Whether TODAY's check-in is the one that landed the streak exactly on a
 * milestone (7 / 14 / 30 / 100). Pure + synchronous: it consumes the streak
 * summary already fetched by the page (`getStreak`), so it adds ZERO DB query.
 *
 * Gated on `todayFilled` so the celebration only fires the day it's earned and
 * then quietly disappears — anti-Black-Hat (§31.2): a one-time calm acknowledgement,
 * never a recurring "you're on a streak" nag or loss-anxiety trigger.
 */
export interface TodayMilestoneInput {
  current: number;
  todayFilled: boolean;
}

export function getTodayMilestone(summary: TodayMilestoneInput): StreakMilestone | null {
  return summary.todayFilled ? crossedMilestone(summary.current) : null;
}
