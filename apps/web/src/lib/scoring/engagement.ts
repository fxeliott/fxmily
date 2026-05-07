/**
 * Engagement score (SPEC §7.11).
 *
 * Engagement is *the member's interaction with the app* — a habit-formation
 * proxy. Yu-kai Chou's "mercy infrastructure" framing applies here: we cap
 * the streak component at 30 days so a 100-day streak doesn't trap the user
 * in a fragile "all-or-nothing" mindset. SPEC §J5 audit-driven hardening
 * already settled this on the streak card.
 *
 * Weights (sum = 100):
 *   - checkinFillRate × 50      — daysWithAnyCheckin / windowDays
 *   - dualSlotRate × 20         — daysWithBothSlots / daysWithAnyCheckin
 *   - streakNormalized × 20     — clamp(streak / 30, 0, 1) × 100 — capped
 *   - journalDepthRate × 10     — eveningsWithJournalNote / eveningsFilled
 *
 * Sample-size guard:
 *   - 0 days with any check-in → status='insufficient_data', reason='no_checkins'.
 *   - <7 days with any check-in → status='insufficient_data', reason='window_short'.
 *
 * Why no Mark Douglas reading rate (yet): J7 ships the library. We track a
 * placeholder for now (`markDouglasReadRate`) so the shape is forward-compat.
 */

import { aggregateDimension, rateSubScore, roundScore, valueSubScore } from './helpers';
import type { EngagementParts, ScoreResult } from './types';

export interface EngagementCheckinInput {
  /** Local-day (YYYY-MM-DD). */
  date: string;
  slot: 'morning' | 'evening';
  /** Evening only — `null` when no journal entry was filled. */
  journalNote: string | null;
}

export interface EngagementInput {
  /**
   * All check-ins across the window (rolling 30 by default). Multiple entries
   * per (date, slot) impossible thanks to the unique index, so we just count.
   */
  checkins: readonly EngagementCheckinInput[];
  /** Current streak from `lib/checkin/streak.ts`. */
  streak: number;
  /** Window length used for the fill-rate denominator. Default 30. */
  windowDays?: number;
}

export const ENGAGEMENT_MIN_DAYS = 7;
export const STREAK_CAP_DAYS = 30;

const WEIGHT_FILL = 50;
const WEIGHT_DUAL_SLOT = 20;
const WEIGHT_STREAK = 20;
const WEIGHT_JOURNAL = 10;

const DEFAULT_WINDOW_DAYS = 30;

export function computeEngagementScore(input: EngagementInput): ScoreResult<EngagementParts> {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Group check-ins by date.
  const byDate = new Map<string, { morning: boolean; evening: boolean; journal: boolean }>();
  for (const c of input.checkins) {
    const e = byDate.get(c.date) ?? { morning: false, evening: false, journal: false };
    if (c.slot === 'morning') e.morning = true;
    if (c.slot === 'evening') {
      e.evening = true;
      if (c.journalNote !== null && c.journalNote.trim() !== '') e.journal = true;
    }
    byDate.set(c.date, e);
  }

  const daysWithAny = Array.from(byDate.values()).filter((e) => e.morning || e.evening).length;
  const daysWithBoth = Array.from(byDate.values()).filter((e) => e.morning && e.evening).length;
  const eveningsFilled = Array.from(byDate.values()).filter((e) => e.evening).length;
  const eveningsWithJournal = Array.from(byDate.values()).filter((e) => e.journal).length;

  if (daysWithAny === 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'no_checkins',
      parts: emptyParts(),
      sample: { days: 0, sufficient: false },
    };
  }
  if (daysWithAny < ENGAGEMENT_MIN_DAYS) {
    const partial = computeParts(
      daysWithAny,
      daysWithBoth,
      eveningsFilled,
      eveningsWithJournal,
      input.streak,
      windowDays,
    );
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'window_short',
      parts: partial.parts,
      sample: { days: daysWithAny, sufficient: false },
    };
  }

  const { parts, partsForAggregate } = computeParts(
    daysWithAny,
    daysWithBoth,
    eveningsFilled,
    eveningsWithJournal,
    input.streak,
    windowDays,
  );
  const score = aggregateDimension(partsForAggregate);

  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { days: daysWithAny, sufficient: true },
  };
}

function computeParts(
  daysWithAny: number,
  daysWithBoth: number,
  eveningsFilled: number,
  eveningsWithJournal: number,
  streak: number,
  windowDays: number,
): {
  parts: EngagementParts;
  partsForAggregate: Array<{ pointsAwarded: number; pointsMax: number } | null>;
} {
  const checkinFillRate = rateSubScore(daysWithAny, windowDays, WEIGHT_FILL);

  const dualSlotRate = rateSubScore(daysWithBoth, daysWithAny, WEIGHT_DUAL_SLOT);

  const streakValue = Math.min(streak, STREAK_CAP_DAYS) / STREAK_CAP_DAYS;
  const streakNormalized = valueSubScore(streakValue, WEIGHT_STREAK, {
    numerator: streak,
    denominator: STREAK_CAP_DAYS,
  });

  // Journal depth applies only when there are evenings.
  const journalDepthRate = rateSubScore(eveningsWithJournal, eveningsFilled, WEIGHT_JOURNAL);

  const parts: EngagementParts = {
    checkinFillRate,
    dualSlotRate,
    streakNormalized,
    journalDepthRate,
  };

  const partsForAggregate = [
    checkinFillRate,
    daysWithAny > 0 ? dualSlotRate : null,
    streakNormalized,
    eveningsFilled > 0 ? journalDepthRate : null,
  ];

  return { parts, partsForAggregate };
}

function emptyParts(): EngagementParts {
  return {
    checkinFillRate: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_FILL,
      numerator: 0,
      denominator: 0,
    },
    dualSlotRate: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_DUAL_SLOT,
      numerator: 0,
      denominator: 0,
    },
    streakNormalized: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_STREAK,
      numerator: 0,
      denominator: STREAK_CAP_DAYS,
    },
    journalDepthRate: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_JOURNAL,
      numerator: 0,
      denominator: 0,
    },
  };
}
