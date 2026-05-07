/**
 * Behavioral scoring (J6).
 *
 * Pure-formula scorers (one per dimension) + persistence service.
 * No Tremor / Recharts imports here — this layer is server-only.
 */

export * from './types';

export {
  computeDisciplineScore,
  type DisciplineCheckinInput,
  type DisciplineInput,
  type DisciplineTradeInput,
  DISCIPLINE_MIN_CHECKIN_DAYS,
  DISCIPLINE_MIN_CLOSED_TRADES,
} from './discipline';

export {
  computeEmotionalStabilityScore,
  type EmotionalStabilityCheckinInput,
  type EmotionalStabilityInput,
  type EmotionalStabilityTradeInput,
  ES_MIN_MOOD_DAYS,
  NEGATIVE_EMOTION_SLUGS,
} from './emotional-stability';

export {
  computeConsistencyScore,
  type ConsistencyInput,
  type ConsistencyTradeInput,
  CONSISTENCY_MIN_TRADES,
} from './consistency';

export {
  computeEngagementScore,
  type EngagementCheckinInput,
  type EngagementInput,
  ENGAGEMENT_MIN_DAYS,
  STREAK_CAP_DAYS,
} from './engagement';

export {
  computeScoresForUser,
  getLatestBehavioralScore,
  persistBehavioralScore,
  recomputeAllActiveMembers,
  recomputeAndPersist,
  type ComputeScoresOptions,
  type RecomputeBatchResult,
  type SerializedBehavioralScore,
} from './service';

export {
  scheduleScoreRecompute,
  RECOMPUTE_DEBOUNCE_MS,
  type ScoreRecomputeReason,
} from './scheduler';
