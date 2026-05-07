/**
 * Emotional Stability score (SPEC §7.11).
 *
 * Mark Douglas, _Trading in the Zone_ ch.6: "the carefree state of mind" is a
 * narrow band of emotional regulation. We measure it via four sub-scores that
 * each capture a distinct dimension of emotional control:
 *
 *   - moodVariance × 40   — *intra-day swing*. Lower stdDev(moodScore) over
 *                            the window = more stable. We rescale stdDev so
 *                            that a 0–8 range of stddev maps to 100→0 score.
 *   - stressMedian × 25   — *baseline pressure*. Median of evening stress
 *                            (1–10). Median(1) → 100, median(10) → 0.
 *   - negativeEmotionRate × 20 — *fear footprint*. Share of evening tag-days
 *                            containing at least one "negative" tag (fear,
 *                            fomo, greedy, overwhelmed, frustrated, tilted,
 *                            doubt, anxious, irritable). Lower = better.
 *   - recoveryAfterLoss × 15 — *tilt resistance*. Average of (mood on the
 *                            day after a losing-trade day) − (baseline mean
 *                            mood), scaled. High = bounces back; low/negative
 *                            = stays down. Skipped when no loss days exist.
 *
 * Sample-size guard:
 *   - <14 days with mood data → status='insufficient_data', reason='window_short'.
 *     Variance from <14 obs is too noisy (per stat lit. 2025/2026 review).
 *   - 0 days → reason='no_checkins'.
 *
 * Renormalization: when `recoveryAfterLoss` cannot be computed (no losses or
 * no day-after-loss data), its 15 points are redistributed onto the other
 * three sub-scores so the dimension still tops out at 100.
 */

import { median, sampleStdDev } from '@/lib/analytics/correlations';

import { aggregateDimension, clamp, roundScore, valueSubScore } from './helpers';
import type { EmotionalStabilityParts, ScoreResult } from './types';

/**
 * Slugs (across both checkin and trading emotion vocabularies) that count
 * toward the "negative footprint" sub-score. Anchored to Mark Douglas's
 * four core fears + the proximate distress states.
 */
export const NEGATIVE_EMOTION_SLUGS: ReadonlySet<string> = new Set([
  // checkin/emotions.ts
  'tired',
  'foggy',
  'irritable',
  'anxious',
  'fearful',
  'fomo',
  'greedy',
  'overwhelmed',
  'frustrated',
  'tilted',
  'doubt',
  // trading/emotions.ts
  'fear-loss',
  'fear-wrong',
  'fear-leaving-money',
  'revenge',
  'panicked',
]);

export interface EmotionalStabilityCheckinInput {
  slot: 'morning' | 'evening';
  /** Local-day, used to align loss-day → next-day-mood. */
  date: string;
  moodScore: number | null;
  stressScore: number | null;
  emotionTags: readonly string[];
}

export interface EmotionalStabilityTradeInput {
  /** Local-day on which the trade closed (YYYY-MM-DD). */
  closeDay: string | null;
  outcome: 'win' | 'loss' | 'break_even' | null;
}

export interface EmotionalStabilityInput {
  checkins: readonly EmotionalStabilityCheckinInput[];
  closedTrades: readonly EmotionalStabilityTradeInput[];
  /** Window length used for sample-size flags. Default 30. */
  windowDays?: number;
}

/** Minimum check-in days with mood data for the dimension to be trusted. */
export const ES_MIN_MOOD_DAYS = 14;

const WEIGHT_MOOD_VAR = 40;
const WEIGHT_STRESS = 25;
const WEIGHT_NEG_EMO = 20;
const WEIGHT_RECOVERY = 15;

/** stdDev → score scaling: stdDev≥8 → 0, stdDev=0 → 100. */
const STDDEV_FULL_SCALE = 8;

/** stress(1)→100, stress(10)→0. */
const STRESS_FULL_SCALE = 10;

export function computeEmotionalStabilityScore(
  input: EmotionalStabilityInput,
): ScoreResult<EmotionalStabilityParts> {
  const moodScores = input.checkins
    .map((c) => c.moodScore)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const moodDays = moodScores.length;

  if (moodDays === 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'no_checkins',
      parts: emptyParts(),
      sample: { days: 0, sufficient: false },
    };
  }
  if (moodDays < ES_MIN_MOOD_DAYS) {
    // Compute parts for transparency but keep the dimension marked as
    // insufficient — the UI hides the score itself.
    const partial = computeParts(input, moodScores);
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'window_short',
      parts: partial.parts,
      sample: { days: moodDays, sufficient: false },
    };
  }

  const { parts, partsForAggregate } = computeParts(input, moodScores);
  const score = aggregateDimension(partsForAggregate);

  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { days: moodDays, sufficient: true },
  };
}

function computeParts(
  input: EmotionalStabilityInput,
  moodScores: number[],
): {
  parts: EmotionalStabilityParts;
  partsForAggregate: Array<{ pointsAwarded: number; pointsMax: number } | null>;
} {
  // 1. Mood variance — high stability = low stdDev.
  const stddev = sampleStdDev(moodScores);
  const moodVarValue = clamp(1 - stddev / STDDEV_FULL_SCALE, 0, 1);
  const moodVariance = valueSubScore(moodVarValue, WEIGHT_MOOD_VAR, {
    denominator: moodScores.length,
  });

  // 2. Stress median — evening only.
  const eveningStress = input.checkins
    .filter((c) => c.slot === 'evening')
    .map((c) => c.stressScore)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let stressSub = valueSubScore(0, WEIGHT_STRESS);
  if (eveningStress.length > 0) {
    const m = median(eveningStress);
    const stressVal = clamp(1 - (m - 1) / (STRESS_FULL_SCALE - 1), 0, 1);
    stressSub = valueSubScore(stressVal, WEIGHT_STRESS, { denominator: eveningStress.length });
  }

  // 3. Negative emotion rate — count of days with ≥1 negative tag among
  //    days that tagged at least one emotion.
  let taggedDays = 0;
  let negDays = 0;
  for (const c of input.checkins) {
    if (c.emotionTags.length === 0) continue;
    taggedDays++;
    if (c.emotionTags.some((s) => NEGATIVE_EMOTION_SLUGS.has(s))) negDays++;
  }
  const negRate = taggedDays > 0 ? negDays / taggedDays : 0;
  const negValue = clamp(1 - negRate, 0, 1);
  const negativeEmotionRate = valueSubScore(negValue, WEIGHT_NEG_EMO, {
    numerator: negDays,
    denominator: taggedDays,
  });

  // 4. Recovery after loss — average mood (J+1 after loss day) − baseline mean mood.
  const recovery = computeRecoveryAfterLoss(input);
  const recoverySub =
    recovery === null
      ? null
      : valueSubScore(recovery.value, WEIGHT_RECOVERY, {
          numerator: recovery.lossDayCount,
          denominator: recovery.followupCount,
        });

  const parts: EmotionalStabilityParts = {
    moodVariance,
    stressMedian: stressSub,
    negativeEmotionRate,
    recoveryAfterLoss: recoverySub,
  };

  const partsForAggregate = [
    moodVariance,
    eveningStress.length > 0 ? stressSub : null,
    taggedDays > 0 ? negativeEmotionRate : null,
    recoverySub,
  ];

  return { parts, partsForAggregate };
}

interface RecoveryComputed {
  /** Normalized 0–1 value: 0.5 = baseline, 1 = bounces back fully, 0 = stays low. */
  value: number;
  lossDayCount: number;
  followupCount: number;
}

function computeRecoveryAfterLoss(input: EmotionalStabilityInput): RecoveryComputed | null {
  // Identify "loss days" — local days on which at least one trade closed as loss.
  const lossDays = new Set<string>();
  for (const t of input.closedTrades) {
    if (t.outcome === 'loss' && t.closeDay !== null) lossDays.add(t.closeDay);
  }
  if (lossDays.size === 0) return null;

  // Build mood-by-day map (avg if multiple slots).
  const moodByDay = new Map<string, { sum: number; n: number }>();
  for (const c of input.checkins) {
    if (c.moodScore == null) continue;
    const e = moodByDay.get(c.date) ?? { sum: 0, n: 0 };
    e.sum += c.moodScore;
    e.n += 1;
    moodByDay.set(c.date, e);
  }
  if (moodByDay.size === 0) return null;

  const baselineSum = Array.from(moodByDay.values()).reduce((s, e) => s + e.sum / e.n, 0);
  const baseline = baselineSum / moodByDay.size; // mean of daily means

  // For each loss day, look up the mood on day+1 (local).
  let followupSum = 0;
  let followupCount = 0;
  for (const lossDay of lossDays) {
    const next = nextDay(lossDay);
    const e = moodByDay.get(next);
    if (!e) continue;
    followupSum += e.sum / e.n;
    followupCount++;
  }
  if (followupCount === 0) return null;
  const followupMean = followupSum / followupCount;

  // Score: how does the day-after-loss mood compare to baseline?
  // delta = followup − baseline, in [-9, +9] roughly. Map to [0, 1] with
  // 0.5 = baseline, 1.0 = +4 above (full recovery), 0.0 = -4 below (stays in tilt).
  const delta = followupMean - baseline;
  const value = clamp(0.5 + delta / 8, 0, 1);
  return { value, lossDayCount: lossDays.size, followupCount };
}

function nextDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map((s) => Number(s));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function emptyParts(): EmotionalStabilityParts {
  return {
    moodVariance: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_MOOD_VAR },
    stressMedian: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_STRESS },
    negativeEmotionRate: { rate: 0, pointsAwarded: 0, pointsMax: WEIGHT_NEG_EMO },
    recoveryAfterLoss: null,
  };
}
