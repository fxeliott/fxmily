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
import type { EngagementParts, ScoreResult, SubScore } from './types';

export interface EngagementCheckinInput {
  /** Local-day (YYYY-MM-DD). */
  date: string;
  slot: 'morning' | 'evening';
  /** Evening only — `null` when no journal entry was filled. */
  journalNote: string | null;
  /**
   * Morning only (DoD#3). Subjective sleep quality 1–10, `null` when not
   * answered. A conservative self-care habit signal (anti-Black-Hat: only ever
   * a positive contribution when present — never a "you sleep badly" penalty).
   */
  sleepQuality?: number | null;
  /**
   * Evening only (SPEC §28/§22). Did the member study Eliot's COURSE today?
   * Tri-state: `true` (studied), `false` (skipped), `null`/absent (not asked /
   * legacy row). A course-adherence habit signal — we score THAT they studied,
   * never the content (SPEC §2). 🔒 Firewall-clean: a plain check-in boolean,
   * NOT the §21 Entraînement/TrainingTrade module.
   */
  formationFollowed?: boolean | null;
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
  /**
   * SPEC §21 J-T4 — number of the member's backtests within the scoring
   * window (effort/volume ONLY). `undefined` (the state of all 30 V1
   * members at deploy — TrainingTrade is empty) → the training sub-score is
   * skipped and engagement renormalizes to exactly its pre-J-T4 value.
   * 🚨 §21.5: this is an integer count — `resultR`/`outcome`/`plannedRR`
   * MUST NEVER be threaded into engagement.
   */
  trainingActivityCount?: number;
  /**
   * SPEC §30.4 J-M4 — number of NON-cancelled meetings scheduled within the
   * scoring window (the attendance-rate DENOMINATOR). `undefined`/`0` (no
   * meeting in the window) → the meeting sub-score is skipped and engagement
   * renormalizes to exactly its pre-J-M4 value (ADDITION PURE).
   * 🚨 §30.7: a raw integer COUNT only — no meeting body / content / P&L.
   */
  meetingScheduledCount?: number;
  /**
   * SPEC §30.4 J-M4 — number of the member's COMPLETE attendances on those
   * scheduled, in-window meetings (the attendance-rate NUMERATOR). Bounded
   * by `meetingScheduledCount`. `undefined`/`0` with a positive scheduled
   * count → the member had meetings but validated none → meeting sub-score
   * `0` → engagement DROPS (the effort signal, SPEC §30.4 crux T2-2).
   * 🚨 §30.7: a raw integer COUNT only.
   */
  meetingCompletedCount?: number;
}

export const ENGAGEMENT_MIN_DAYS = 7;
export const STREAK_CAP_DAYS = 30;

const WEIGHT_FILL = 50;
const WEIGHT_DUAL_SLOT = 20;
const WEIGHT_STREAK = 20;
const WEIGHT_JOURNAL = 10;

const DEFAULT_WINDOW_DAYS = 30;

/**
 * SPEC §21 J-T4 — training sub-score weight. Added as a PURE addition: the
 * other four weights are deliberately NOT rebalanced. `aggregateDimension`
 * normalizes by the *active* `pointsMax`, so when a member has no training
 * activity the part is `null` and the dimension renormalizes to EXACTLY its
 * pre-J-T4 value — a provable zero regression for the 30 V1 members (whose
 * TrainingTrade set is empty at deploy). Heuristic, ADR-001-style (no
 * empirical backing yet), placed between journal (10) and streak/dual-slot
 * (20): regular backtest practice is a meaningful but non-dominant
 * engagement behaviour vs the daily check-in (50).
 */
const WEIGHT_TRAINING = 15;

/**
 * Backtests within the window at/above which the training sub-score
 * saturates (rate = 1) — ~2/week over a 30d window = "regular practice".
 * Capped like `STREAK_CAP_DAYS` so there is no toxic grind incentive.
 * Heuristic (ADR-001-style), tunable.
 */
const TRAINING_ACTIVITY_TARGET = 8;

/**
 * SPEC §30.4 J-M4 — meeting (réunion Fxmily) attendance sub-score weight.
 * Added as a PURE ADDITION (SPEC §30.7 invariant): the existing five weights
 * (50/20/20/10 + training 15) are deliberately NOT rebalanced — the blueprint
 * that proposes `WEIGHT_FILL 50→42` is a real regression and is REJECTED.
 * `aggregateDimension` renormalizes by the *active* `pointsMax`, so a member
 * with no meeting in the window (`scheduledCount === 0` → part `null`) scores
 * byte-identically to pre-J-M4. Heuristic (ADR-001-style), placed level with
 * training (15): meeting assiduity is a meaningful but non-dominant engagement
 * behaviour vs the daily check-in (50). Tunable.
 */
const WEIGHT_MEETING = 15;

/**
 * DoD#3 — sleep (self-care) sub-score weight. Added as a PURE ADDITION: the
 * existing weights (50/20/20/10 + training 15 + meeting 15) are deliberately
 * NOT rebalanced. `aggregateDimension` normalizes by the *active* `pointsMax`,
 * so a member who logs no sleep quality scores byte-identically to pre-DoD#3.
 * Sized conservatively (10, level with `journalDepthRate`): sleep is a
 * wellness/habit-adherence act, meaningful but non-dominant vs the daily
 * check-in (50). Anti-Black-Hat: only a positive contribution when present.
 */
const WEIGHT_SLEEP = 10;

/** DoD#3 — subjective sleep-quality scale max (the field is 1–10). */
const SLEEP_QUALITY_SCALE = 10;

/**
 * SPEC §28/§22 — course-adherence ("formation suivie") sub-score weight. Added
 * as a PURE ADDITION: the existing weights (50/20/20/10 + training 15 + meeting
 * 15 + sleep 10) are deliberately NOT rebalanced. `aggregateDimension`
 * normalizes by the *active* `pointsMax`, so a member with no evening carrying
 * the field scores BYTE-IDENTICALLY to pre-§28. Sized conservatively (10, level
 * with `journalDepthRate`/`sleepQualityRate`): following the course is a
 * meaningful but non-dominant engagement habit vs the daily check-in (50).
 * Heuristic (ADR-001-style), tunable. 🔒 Firewall-clean: derived from a plain
 * `DailyCheckin` boolean, NO `@/lib/training` coupling.
 */
const WEIGHT_FORMATION = 10;

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

  // DoD#3 — subjective sleep quality, averaged over mornings where the member
  // answered (`sleepQuality !== null`). A self-care habit signal: when no
  // morning carries it the sub-score is skipped (null → renormalized away →
  // byte-identical to pre-DoD#3). NaN/Infinity are guarded out like moodScore.
  let sleepQualitySum = 0;
  let sleepQualityDays = 0;
  for (const c of input.checkins) {
    if (c.slot !== 'morning') continue;
    const q = c.sleepQuality;
    if (typeof q !== 'number' || !Number.isFinite(q)) continue;
    sleepQualitySum += q;
    sleepQualityDays += 1;
  }

  // SPEC §28/§22 — course adherence ("formation suivie"), a true fill-rate over
  // EVENINGS where the member was asked (`formationFollowed !== null`). When no
  // evening carries it the sub-score is skipped (null → renormalized away →
  // byte-identical to pre-§28). Numerator = evenings the course was studied.
  let formationAsked = 0;
  let formationStudied = 0;
  for (const c of input.checkins) {
    if (c.slot !== 'evening') continue;
    const f = c.formationFollowed;
    if (f === null || f === undefined) continue;
    formationAsked += 1;
    if (f === true) formationStudied += 1;
  }

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
      input.trainingActivityCount,
      input.meetingScheduledCount,
      input.meetingCompletedCount,
      sleepQualitySum,
      sleepQualityDays,
      formationStudied,
      formationAsked,
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
    input.trainingActivityCount,
    input.meetingScheduledCount,
    input.meetingCompletedCount,
    sleepQualitySum,
    sleepQualityDays,
    formationStudied,
    formationAsked,
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
  trainingActivityCount: number | undefined,
  meetingScheduledCount: number | undefined,
  meetingCompletedCount: number | undefined,
  sleepQualitySum: number,
  sleepQualityDays: number,
  formationStudied: number,
  formationAsked: number,
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

  // SPEC §21 J-T4 — training (backtest) volume. `null` (skipped → renormalized
  // away by `aggregateDimension`) unless the member actually has recent
  // backtest activity, so a non-backtester's engagement is byte-identical to
  // pre-J-T4. Mirrors `streakNormalized` (a capped count, not a fill-rate).
  // 🚨 §21.5: `trainingActivityCount` is a COUNT — never a backtest P&L.
  const trainingActivityRate: SubScore | null =
    trainingActivityCount !== undefined && trainingActivityCount > 0
      ? valueSubScore(
          Math.min(trainingActivityCount, TRAINING_ACTIVITY_TARGET) / TRAINING_ACTIVITY_TARGET,
          WEIGHT_TRAINING,
          { numerator: trainingActivityCount, denominator: TRAINING_ACTIVITY_TARGET },
        )
      : null;

  // SPEC §30.4 J-M4 — meeting attendance: completed / scheduled in the window.
  // Carbon copy of `journalDepthRate` (a true fill-rate, NOT a capped count
  // like training): `rateSubScore` returns pointsAwarded:0 when the denominator
  // is 0, but the SKIP is keyed on `scheduledCount` below (the §30.4 crux T2-2),
  // NOT on `completedCount` — so a member who HAD meetings but validated none
  // gets a real `0` sub-score (engagement drops), while a member with NO meeting
  // in the window is skipped (null → renormalized → byte-identical).
  // 🚨 §30.7: two integer COUNTS only — never a meeting body / content / P&L.
  const meetingAttendanceRate = rateSubScore(
    meetingCompletedCount ?? 0,
    meetingScheduledCount ?? 0,
    WEIGHT_MEETING,
  );

  // DoD#3 — sleep self-care signal. `valueSubScore` on the normalized average
  // sleep quality (avg / 10), exactly like `streakNormalized`/`trainingActivityRate`
  // build a value sub-score from a normalized [0,1] input. `null` (skipped →
  // renormalized away) when no morning carried `sleepQuality`, so a member who
  // never logs sleep is byte-identical to pre-DoD#3. Anti-Black-Hat: only ever
  // a positive contribution — never a "you sleep badly" penalty.
  const sleepQualityRate: SubScore | null =
    sleepQualityDays > 0
      ? valueSubScore(sleepQualitySum / sleepQualityDays / SLEEP_QUALITY_SCALE, WEIGHT_SLEEP, {
          numerator: sleepQualitySum,
          denominator: sleepQualityDays,
        })
      : null;

  // SPEC §28/§22 — course adherence. EXACT mirror of `journalDepthRate` (a true
  // fill-rate over evenings): `rateSubScore` returns pointsAwarded:0 when the
  // denominator is 0, but the SKIP below is keyed on `formationAsked` so an
  // evening where the member was never asked never penalizes the rate. `null`
  // when no evening carried the field → renormalized away → byte-identical to
  // pre-§28. Anti-Black-Hat: a "Pas aujourd’hui" lowers the rate but is never a
  // punitive event — it is just the honest signal. 🔒 No `@/lib/training` import.
  const formationRate = rateSubScore(formationStudied, formationAsked, WEIGHT_FORMATION);
  const formationFollowedRate: SubScore | null = formationAsked > 0 ? formationRate : null;

  const parts: EngagementParts = {
    checkinFillRate,
    dualSlotRate,
    streakNormalized,
    journalDepthRate,
    trainingActivityRate,
    // Surfaced for transparency even when skipped (denom 0 → rate 0, pts 0).
    meetingAttendanceRate: (meetingScheduledCount ?? 0) > 0 ? meetingAttendanceRate : null,
    // Already `null` when no morning carried a sleepQuality value.
    sleepQualityRate,
    // SPEC §28/§22 — already `null` when no evening carried the field.
    formationFollowedRate,
  };

  const partsForAggregate = [
    checkinFillRate,
    daysWithAny > 0 ? dualSlotRate : null,
    streakNormalized,
    eveningsFilled > 0 ? journalDepthRate : null,
    // Already `null` when the member has no recent training activity.
    trainingActivityRate,
    // SPEC §30.4 — EXACT mirror of `eveningsFilled > 0 ? journalDepthRate : null`
    // above: skip on `scheduledCount` (NOT completedCount). 0 scheduled → null →
    // renormalize → byte-identical; >0 scheduled & 0 completed → rate 0 → drop.
    (meetingScheduledCount ?? 0) > 0 ? meetingAttendanceRate : null,
    // DoD#3 — already `null` when no morning carried a sleepQuality value →
    // renormalized away → byte-identical to pre-DoD#3.
    sleepQualityRate,
    // SPEC §28/§22 — already `null` when no evening carried `formationFollowed`
    // → renormalized away → byte-identical to pre-§28.
    formationFollowedRate,
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
    trainingActivityRate: null,
    meetingAttendanceRate: null,
    sleepQualityRate: null,
    formationFollowedRate: null,
  };
}
