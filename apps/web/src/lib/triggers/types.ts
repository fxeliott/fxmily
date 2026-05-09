/**
 * Mark Douglas trigger engine — canonical types (J7, SPEC §7.6).
 *
 * Triggers are deterministic JSON rules persisted in `MarkDouglasCard.triggerRules`.
 * Seven canonical kinds covering the SPEC §7.6 table:
 *
 *   1. `after_n_consecutive_losses` — N losing closes in a row → tilt mgmt.
 *   2. `plan_violations_in_window`  — N plan-not-respected over D days → discipline.
 *   3. `sleep_deficit_then_trade`   — sleep < H h same day as a trade → fatigue.
 *   4. `emotion_logged`             — a Douglas-fear emotion appears (FOMO, etc).
 *   5. `win_streak`                 — N wins in a row → over-confidence.
 *   6. `no_checkin_streak`          — D days without any check-in → consistency.
 *   7. `hedge_violation`            — most recent trade with hedge=false.
 *
 * Engine architecture (pure-functions first, side-effects in service layer):
 *
 *   ┌─────────────┐    fetch    ┌──────────────┐  evaluate (pure)  ┌─────────┐
 *   │ Server Act. │ ────────►   │ TriggerCtx   │  ───────────────► │  match  │
 *   │  (after())  │             │ (last 30d)   │                   │  list   │
 *   └─────────────┘             └──────────────┘                   └────┬────┘
 *                                                                       │
 *   ┌─────────────────────────────────────────────────────────────┐     │
 *   │ pickBestCard(matched, cooldown, priority) → 0 or 1 delivery │ ◄───┘
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Pure functions live in `evaluators.ts`. DB-bound logic (cooldown lookup,
 * fetch trades, persist delivery) lives in `cooldown.ts` + `engine.ts`. This
 * separation keeps the unit tests deterministic without Prisma.
 */

import type { TradeOutcome, TradeSession } from '@/generated/prisma/enums';

// =============================================================================
// Trigger rule discriminated union
// =============================================================================

/**
 * Window mode for `after_n_consecutive_losses`. The "tilt" psychology of Mark
 * Douglas (Trading in the Zone, ch.10) treats consecutive losses as a
 * mental-state phenomenon, not strictly a time-bound one — three losses
 * spread over three days hits the trader emotionally as much as three losses
 * in an hour. Default `'any'` matches that spirit; `'rolling_24h'` and
 * `'session'` are configurable per card for finer-grained pushes.
 */
export type ConsecutiveLossesWindow = 'any' | 'rolling_24h' | 'session';

/**
 * Tag slugs that the `emotion_logged` trigger watches for. Maps the four
 * Douglas fears across the trade and check-in vocabularies (the trade picker
 * and the check-in picker share semantics but ship slightly different slug
 * lists — see `lib/trading/emotions.ts` and `lib/checkin/emotions.ts`).
 */
export type DouglasEmotionTag =
  // Trade emotions (lib/trading/emotions.ts)
  | 'fomo'
  | 'fear-loss'
  | 'fear-wrong'
  | 'fear-leaving-money'
  // Phase V/W (2026-05-09) — promotion V1.5 → V1. Ces 2 slugs existent
  // dans lib/trading/emotions.ts mais n'étaient pas câblés comme triggers.
  | 'revenge-trade'
  | 'overconfident'
  // Check-in emotions (lib/checkin/emotions.ts)
  | 'fearful'
  | 'greedy'
  | 'doubt';

/** Discriminated-union of all 7 trigger kinds. Each carries its own params. */
export type TriggerRule =
  | {
      kind: 'after_n_consecutive_losses';
      n: number;
      window: ConsecutiveLossesWindow;
    }
  | {
      kind: 'plan_violations_in_window';
      n: number;
      days: number;
    }
  | {
      kind: 'sleep_deficit_then_trade';
      minHours: number;
    }
  | {
      kind: 'emotion_logged';
      tag: DouglasEmotionTag;
    }
  | {
      kind: 'win_streak';
      n: number;
    }
  | {
      kind: 'no_checkin_streak';
      days: number;
    }
  | {
      kind: 'hedge_violation';
    };

export type TriggerKind = TriggerRule['kind'];

// =============================================================================
// Evaluation context — pure data the evaluators read
// =============================================================================

/** Closed-trade snapshot fed to evaluators. Trimmed to what they need. */
export interface TriggerTradeInput {
  /** Used to order chronologically (we sort by closedAt asc). */
  closedAt: Date | null;
  /** Used to scope to "today" or "session" windows. */
  exitedAt: Date | null;
  /** Same-day correlation with check-ins. */
  enteredAt: Date;
  outcome: TradeOutcome | null;
  session: TradeSession;
  planRespected: boolean;
  /** `null` = N/A (no hedge applicable on this trade). */
  hedgeRespected: boolean | null;
  /** Multi-tags selected before entry. */
  emotionBefore: string[];
  /** Multi-tags selected after exit. May be empty when still open. */
  emotionAfter: string[];
}

/** Daily check-in snapshot fed to evaluators. */
export interface TriggerCheckinInput {
  /** Local-day YYYY-MM-DD (matches DailyCheckin.date stored as @db.Date). */
  date: string;
  slot: 'morning' | 'evening';
  /** May be null if the slot was filled but mood wasn't (defensive). */
  moodScore: number | null;
  /** Hours of sleep recorded in the morning check-in. Null otherwise. */
  sleepHours: number | null;
  /** Plan respected today (evening checkin field). */
  planRespectedToday: boolean | null;
  /** Tag slugs from `lib/checkin/emotions.ts`. */
  emotionTags: string[];
}

/**
 * Aggregated per-evaluation context. Built once by the engine, passed to all 7
 * evaluators. `now` and `timezone` make the evaluators deterministic for
 * tests (no `Date.now()` calls inside).
 */
export interface TriggerContext {
  /** Stable instant of evaluation — every evaluator references this clock. */
  now: Date;
  /** IANA timezone used to compute "today" for date-anchored rules. */
  timezone: string;
  /** Today's local-day YYYY-MM-DD (matches `lib/checkin/timezone.ts`). */
  todayLocal: string;
  /** Closed trades within the last 30 days, oldest-first by `closedAt`. */
  recentClosedTrades: TriggerTradeInput[];
  /** Check-ins within the last 60 days, oldest-first by `date`. */
  recentCheckins: TriggerCheckinInput[];
  /** All trades (open + closed) within last 30 days, used by `hedge_violation`. */
  recentAllTrades: TriggerTradeInput[];
  /** User account creation date — used to skip onboarding-day false positives. */
  userCreatedAt: Date;
}

// =============================================================================
// Evaluation result
// =============================================================================

/**
 * Result of evaluating a single rule against a context.
 *
 * `triggeredBy` is the FR human-readable label persisted on
 * `MarkDouglasDelivery.triggeredBy`. Examples:
 *   - "3 trades perdants consécutifs sur 24h"
 *   - "Plan non respecté 2 fois sur 7 jours"
 *
 * `snapshot` is the structured JSON persisted on
 * `MarkDouglasDelivery.triggerSnapshot` for audit + replay. NEVER PII — only
 * trade IDs (when relevant), counts, and rule params.
 */
export type TriggerEvalResult =
  | {
      matched: true;
      triggeredBy: string;
      snapshot: TriggerSnapshot;
    }
  | {
      matched: false;
    };

/** Discriminated by `kind` so the audit row can be replayed deterministically. */
export type TriggerSnapshot = {
  kind: TriggerKind;
  /** Original rule params for replay/debugging. */
  rule: TriggerRule;
  /** Rule-specific context: counts, recent IDs, dates, etc. */
  details: Record<string, unknown>;
};

// =============================================================================
// Hat class (Yu-kai Chou Octalysis)
// =============================================================================

/**
 * Hat class controls cooldown duration. White-hat cards (empowering: mastery,
 * meaning, ownership) get a tighter cooldown — they're safe to repeat. Black-
 * hat cards (urgency-driven: loss-avoidance, scarcity) get a longer cooldown —
 * the trader needs space to integrate before another such nudge.
 *
 * Reference: Yu-kai Chou, *Actionable Gamification*, ch.5 — White Hat /
 * Black Hat distinction. The 7d/14d numbers are V1 defaults, tunable per-card
 * later via an admin setting (J7.5+).
 */
export type HatClass = 'white' | 'black';

export const COOLDOWN_DAYS_BY_HAT: Record<HatClass, number> = {
  white: 7,
  black: 14,
};

export function isHatClass(value: string): value is HatClass {
  return value === 'white' || value === 'black';
}
