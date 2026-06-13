/**
 * Zod schemas for `MonthlyDebrief` (V1.4 — SPEC §25, jalon #2 séquence §21.6).
 *
 * Carbon of `lib/schemas/weekly-report.ts` (V1.7 pipeline) adapted to the
 * monthly cadence + the §25 compartmentalised, dual-section output:
 *
 *   - `monthlyDebriefOutputSchema` — what the batch-local Claude Max run
 *     must return (JSON strict). Validated TWICE (envelope JSON-schema +
 *     this post-parse double-net, enum-fuzzing defense — canon V1.7.2).
 *   - `monthlySnapshotSchema` — what the PURE aggregator produces from DB
 *     data, fed to Claude as the user prompt. **Two strictly-walled
 *     sections**: `real` (legitimate P&L of REAL trades) and `training`
 *     (§21.5 firewall — count/recency ONLY, structurally no backtest P&L).
 *   - `monthlyDebriefCostSchema` / `monthlyDebriefPersistInputSchema` —
 *     cost tracking + DB-write input (mirror weekly).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5/§25.7 — BLOCKING). The `training`
 * slice carries ONLY a non-negative count + a recency integer + a boolean.
 * `.strict()` STRUCTURALLY rejects any smuggled `resultR` / `outcome` /
 * `plannedRR`. This file contains ZERO P&L-backtest token by construction
 * (the blocking anti-leak suite Block G pins that).
 *
 * Hardening mirrors weekly: `safeFreeText` (NFC + bidi/zero-width strip)
 * on every free-text field, `.strict()` everywhere (reject hallucinated
 * keys), refine `containsBidiOrZeroWidth`.
 */

import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

// =============================================================================
// Constants
// =============================================================================

export const NARRATIVE_MIN_CHARS = 120;
export const NARRATIVE_MAX_CHARS = 1400;
export const SECTION_MIN_CHARS = 80;
export const SECTION_MAX_CHARS = 900;
export const ITEM_MIN_CHARS = 20;
export const ITEM_MAX_CHARS = 300;
export const RISKS_MIN = 0;
export const RISKS_MAX = 5;
export const RECOMMENDATIONS_MIN = 1;
export const RECOMMENDATIONS_MAX = 5;
export const PATTERN_VALUE_MAX_CHARS = 400;
/// ≤4 weekly AI summaries of the civil month are ingested as INPUT context
/// (SPEC §25.3 — never an FK). Each is itself a persisted weekly summary
/// (weekly SUMMARY_MAX = 800) — re-hardened here defense-in-depth.
export const WEEKLY_CONTEXT_MAX = 4;
export const WEEKLY_CONTEXT_ITEM_MAX_CHARS = 900;

// Free-text item — anti-injection hardened (carbon weekly `safeItemSchema`).
const safeItemSchema = z
  .string()
  .trim()
  .min(ITEM_MIN_CHARS)
  .max(ITEM_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const safeNarrativeSchema = z
  .string()
  .trim()
  .min(NARRATIVE_MIN_CHARS)
  .max(NARRATIVE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const safeSectionSchema = z
  .string()
  .trim()
  .min(SECTION_MIN_CHARS)
  .max(SECTION_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const safePatternValueSchema = z
  .string()
  .trim()
  .max(PATTERN_VALUE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

// =============================================================================
// Patterns object — month-over-month observations
// =============================================================================

/// Cross-month patterns the AI surfaces. All optional — omitted when the
/// sample is insufficient (canon J6 sample-size guard / §25.4 "mois calme").
export const monthlyDebriefPatternsSchema = z
  .object({
    /// Month-over-month progression signal (ex: "discipline 71%→84% sur 2 mois").
    monthOverMonth: safePatternValueSchema.optional(),
    /// Real-trading behavioural pattern (ex: "FOMO -0.5R moyen sur 9 trades réels").
    realTrend: safePatternValueSchema.optional(),
    /// Training-practice rhythm (§21.5-safe — effort/regularity, never P&L).
    trainingRhythm: safePatternValueSchema.optional(),
    /// Discipline trajectory (ex: "plan respect 78% (vs 65% mois -1)").
    disciplineTrend: safePatternValueSchema.optional(),
  })
  .strict();

export type MonthlyDebriefPatterns = z.infer<typeof monthlyDebriefPatternsSchema>;

// =============================================================================
// Output schema — what Claude must return (JSON strict, double-net)
// =============================================================================

/// SPEC §25.3 — compartmentalised dual-section output. `summaryReal` and
/// `summaryTraining` are STRICTLY separate fields so the §21.5 boundary is
/// visible in the data model itself (not just in prose).
export const monthlyDebriefOutputSchema = z
  .object({
    /// Headline month-over-month progression narrative (the V1.4 value-add
    /// vs the weekly digest).
    progressionNarrative: safeNarrativeSchema,
    /// Real-trading section (legitimate P&L coaching of REAL trades).
    summaryReal: safeSectionSchema,
    /// Training-practice section — §21.5 firewall: process/effort only,
    /// NEVER a backtest result. The snapshot fed to Claude carries no
    /// backtest P&L, so the model cannot reference one.
    summaryTraining: safeSectionSchema,
    risks: z.array(safeItemSchema).min(RISKS_MIN).max(RISKS_MAX),
    recommendations: z.array(safeItemSchema).min(RECOMMENDATIONS_MIN).max(RECOMMENDATIONS_MAX),
    patterns: monthlyDebriefPatternsSchema,
  })
  .strict();

export type MonthlyDebriefOutput = z.infer<typeof monthlyDebriefOutputSchema>;

// =============================================================================
// Cost-tracking schema (carbon weekly — batch-local Claude Max ⇒ 0€ marginal,
// kept for traceability/audit, SPEC §25.2/§25.3)
// =============================================================================

export const monthlyDebriefCostSchema = z
  .object({
    claudeModel: z.string().min(4).max(80),
    inputTokens: z.number().int().min(0).max(2_000_000),
    outputTokens: z.number().int().min(0).max(50_000),
    cacheReadTokens: z.number().int().min(0).max(2_000_000).default(0),
    cacheCreateTokens: z.number().int().min(0).max(2_000_000).default(0),
    /// EUR with 6-decimal precision (sub-cent tracking, SPEC §16/§25.3).
    costEur: z
      .union([z.number(), z.string()])
      .transform((v) => (typeof v === 'string' ? v : v.toFixed(6))),
  })
  .strict();

export type MonthlyDebriefCost = z.infer<typeof monthlyDebriefCostSchema>;

// =============================================================================
// Persisted schema — output + cost + civil-month dates (DB write)
// =============================================================================

export const monthlyDebriefPersistInputSchema = monthlyDebriefOutputSchema.extend({
  // V1.10 canon: cuid (25) / nanoid (32) + margin, tightened from 128.
  userId: z.string().min(1).max(40),
  monthStart: z.date(),
  monthEnd: z.date(),
  cost: monthlyDebriefCostSchema,
});

export type MonthlyDebriefPersistInput = z.infer<typeof monthlyDebriefPersistInputSchema>;

// =============================================================================
// Snapshot schema — what the PURE aggregator produces (input to Claude)
// =============================================================================

/// (A) REAL section — civil-month aggregates of REAL trades. Legitimate
/// P&L: this is the member's real edge, coaching it is the product. Pure
/// numerics (carbon weekly `counterSliceSchema`).
const realCounterSliceSchema = z
  .object({
    tradesTotal: z.number().int().min(0),
    tradesWin: z.number().int().min(0),
    tradesLoss: z.number().int().min(0),
    tradesBreakEven: z.number().int().min(0),
    tradesOpen: z.number().int().min(0),
    realizedRSum: z.number(),
    realizedRMean: z.number().nullable(),
    /// D3-04 — reliability split of the closed-trade R that fed the aggregates:
    /// `computed` (derived from a real SL) vs `estimated` (fallback when the SL
    /// was skipped). Lets Claude weight the mean R by trustworthiness. Always
    /// present (the aggregator always computes the split).
    realizedRReliability: z
      .object({
        computed: z.number().int().nonnegative(),
        estimated: z.number().int().nonnegative(),
      })
      .strict(),
    planRespectRate: z.number().min(0).max(1).nullable(),
    hedgeRespectRate: z.number().min(0).max(1).nullable(),
    /// SPEC §28/§21 — Session-2 process/habit axes as EXPLICIT NAMED COUNTERS
    /// (count-only behavioural rates, posture §2 — the ACT, never P&L) so the
    /// autonomous monthly Claude run can reason on each axis BY NAME instead of
    /// only via the rolled-up discipline/engagement scores. `true / answered`
    /// over the month, `null` when nobody answered (no fake "0 %"). Always
    /// present (the aggregator always computes them). Carbon of weekly.
    processCompleteRate: z.number().min(0).max(1).nullable(),
    formationFollowedRate: z.number().min(0).max(1).nullable(),
    marketAnalysisDoneRate: z.number().min(0).max(1).nullable(),
    morningRoutineCompletedRate: z.number().min(0).max(1).nullable(),
    /// `meetingAttendance` — completed / scheduled Fxmily meetings in the
    /// month (count-only primitive `countMeetingAttendance`, §30.4). `rate` is
    /// `null` when `scheduled === 0` (honest empty state, never a fake "0 %").
    meetingAttendance: z
      .object({
        scheduled: z.number().int().min(0),
        completed: z.number().int().min(0),
        rate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    morningCheckinsCount: z.number().int().min(0),
    eveningCheckinsCount: z.number().int().min(0),
    distinctCheckinDays: z.number().int().min(0),
    sleepHoursMedian: z.number().min(0).max(24).nullable(),
    moodMedian: z.number().min(1).max(10).nullable(),
    stressMedian: z.number().min(1).max(10).nullable(),
    annotationsReceived: z.number().int().min(0),
    annotationsViewed: z.number().int().min(0),
    douglasCardsDelivered: z.number().int().min(0),
    douglasCardsSeen: z.number().int().min(0),
    douglasCardsHelpful: z.number().int().min(0),
    tradesQualityA: z.number().int().min(0),
    tradesQualityB: z.number().int().min(0),
    tradesQualityC: z.number().int().min(0),
    tradesQualityCaptured: z.number().int().min(0),
    riskPctMedian: z.number().min(0).max(100).nullable(),
    riskPctOverTwoCount: z.number().int().min(0),
  })
  .strict();

/**
 * (B) TRAINING section — 🚨 §21.5 FIREWALL (SPEC §25.3/§25.7, BLOCKING).
 *
 * Count + recency ONLY, sourced exclusively from the J-T4 sanctioned
 * primitive `countRecentTrainingActivity` ({ count, lastEnteredAt }) by
 * the loader. NEVER a backtest P&L. The field names are deliberately
 * effort/recency words; `.strict()` STRUCTURALLY rejects a smuggled
 * `resultR` / `outcome` / `plannedRR` key (Block E/G pin this at runtime).
 */
const trainingEffortSliceSchema = z
  .object({
    /// Backtests entered within the civil-month window (volume of practice).
    backtestCount: z.number().int().min(0),
    /// Whole days since the member's all-time most recent backtest, derived
    /// by the loader from `lastEnteredAt` with the member tz. `null` = the
    /// member has never logged a backtest.
    daysSinceLastBacktest: z.number().int().min(0).nullable(),
    /// `true` iff the member has ever logged at least one backtest (so the
    /// AI can phrase "n'a pas encore commencé l'entraînement" honestly vs a
    /// misleading "0 ce mois", canon §21.4/§23.4 "mois calme").
    hasEverPractised: z.boolean(),
  })
  .strict();

/// One side (baseline N-1 OR current) of `scoreProgression` — the 4
/// behavioural dimensions at a given anchor date. Each dimension is
/// `number | null` (`insufficient_data` that day is NEVER a fabricated 0).
const scoreProgressionSideSchema = z
  .object({
    discipline: z.number().nullable(),
    emotionalStability: z.number().nullable(),
    consistency: z.number().nullable(),
    engagement: z.number().nullable(),
  })
  .strict();

/// DoD#3 / §29 "progression MESURABLE" — month-over-month delta of the
/// behavioural scores, ANCHORED in real N-1 vs N numbers (not a qualitative
/// guess). `previous` = the member's entry-of-month score (the trend point
/// closest BEFORE/ON the 1st), `current` = the most-recent trend point,
/// `delta` = current − previous per dimension (ONLY when BOTH bounds are
/// non-null, else `null` for that dimension). `null` (the whole object) when
/// there is no baseline before month start OR fewer than 2 points — HONEST,
/// the builder never fabricates a progression from a single snapshot.
/// Posture §2: these are internal PSYCHOLOGICAL scores, never market data.
const scoreProgressionSchema = z
  .object({
    previous: scoreProgressionSideSchema,
    current: scoreProgressionSideSchema,
    delta: scoreProgressionSideSchema,
    /// `YYYY-MM-DD` anchor of the baseline (N-1) trend point.
    previousDate: z.string(),
    /// `YYYY-MM-DD` anchor of the current (N) trend point.
    currentDate: z.string(),
  })
  .strict();

/// (C) VÉRIFICATION & CONSTANCE — Session 3 (DOD3-01, DoD#2 S6). COUNT-ONLY,
/// posture §2/§33.2 : des nombres factuels (jamais un compteur de culpabilité,
/// jamais un avis marché). `constancy` est le **ConstancyScore S3 DÉDIÉ**
/// (event-sourced : honnêteté/régularité/discipline + écarts/alertes confrontés
/// à la réalité MT5), STRICTEMENT DISTINCT du sous-score `consistency` de
/// `BehavioralScore` (S2/S5, plus haut). `null` quand le membre n'a aucun signal
/// de constance sur la période rapportée (pas de faux score neutre — anti-
/// complaisance §33.6). `openDiscrepancyCount` = écarts de vérité encore OUVERTS
/// (« à regarder », jamais une faute). `alertCount` = alertes PSYCHOLOGIQUES
/// déclenchées dans la période (répétition uniquement §33.8 — `Alert.category`
/// est l'enum mono-valeur `psychological`, un signal trading est structurellement
/// impossible). `constancyPrevious` = le ConstancyScore DÉDIÉ du MOIS PRÉCÉDENT
/// (§29 « voir son évolution ») — sert le récit de progression mois-sur-mois de
/// la constance/honnêteté (miroir du `scoreProgression` comportemental). `null`
/// si aucun signal le mois d'avant (le prompt omet alors la ligne d'évolution).
const constancySnapshotSchema = z
  .object({
    value: z.number().min(0).max(100),
    honesty: z.number().min(0).max(100).nullable(),
    regularity: z.number().min(0).max(100).nullable(),
    discipline: z.number().min(0).max(100).nullable(),
  })
  .strict();

const verificationSliceSchema = z
  .object({
    constancy: constancySnapshotSchema.nullable(),
    constancyPrevious: constancySnapshotSchema.nullable(),
    openDiscrepancyCount: z.number().int().min(0),
    alertCount: z.number().int().min(0),
  })
  .strict();

const pseudonymLabelSchema = z
  .string()
  .regex(/^member-[A-F0-9]{8}$/, 'pseudonymLabel must match member-XXXXXXXX (uppercase hex).');

export const monthlySnapshotSchema = z
  .object({
    pseudonymLabel: pseudonymLabelSchema,
    timezone: z.string().min(3).max(60),
    monthStart: z.date(),
    monthEnd: z.date(),
    /// Whole days the member's account existed within the window (account-age
    /// guard, canon J-T4 — lets the AI honour "inscrit en cours de mois").
    accountAgeDaysInWindow: z.number().int().min(0),
    real: realCounterSliceSchema,
    training: trainingEffortSliceSchema,
    /// FIX C S5 — Emotion tags (trade before/during/after + checkin emotionTags),
    /// sorted by frequency descending, capped at 20. Carbon of the weekly
    /// freeText.emotionTags slice. Enables the monthly Claude run to detect
    /// dominant fears (FOMO, fear-loss, etc.) across the full month, matching
    /// the weekly path. Empty array when no trades/checkins in the window.
    emotionTags: z
      .array(
        z
          .object({
            tag: z.string().min(1).max(60),
            count: z.number().int().min(1),
          })
          .strict(),
      )
      .max(20),
    /// D3-01 — post-outcome behavioural bias tags (CFA LESSOR + Steenbarger:
    /// revenge-trade, loss-aversion, overconfidence…) declared on the month's
    /// trades, frequency-sorted, capped at 12. Mirror of `emotionTags`. These
    /// are PSYCHOLOGICAL self-declarations (posture §2 — never a market signal).
    /// Empty array when no trade carried a bias tag.
    behaviorTags: z
      .array(
        z
          .object({
            tag: z.string().min(1).max(60),
            count: z.number().int().min(1),
          })
          .strict(),
      )
      .max(12),
    /// ≤4 weekly AI summaries of the civil month, INPUT context only (SPEC
    /// §25.3 — never an FK). Already safeFreeText at weekly persist; the
    /// `.transform` re-hardens defense-in-depth (mirror builder journals).
    weeklySummaries: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(WEEKLY_CONTEXT_ITEM_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(WEEKLY_CONTEXT_MAX),
    /// Behavioural score snapshot (`lib/scoring`). Null = `insufficient_data`.
    scores: z
      .object({
        discipline: z.number().int().min(0).max(100).nullable(),
        emotionalStability: z.number().int().min(0).max(100).nullable(),
        consistency: z.number().int().min(0).max(100).nullable(),
        engagement: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    /// DoD#3 / §29 — month-over-month progression of the behavioural scores,
    /// anchored in REAL N-1 vs N numbers (`previous`/`current`/`delta`). `null`
    /// when no baseline exists before month start or <2 trend points (honest —
    /// never a fabricated progression). Surfaced to the prompt so the
    /// `progressionNarrative` rests on measured deltas, not a qualitative guess.
    scoreProgression: scoreProgressionSchema.nullable(),
    /// DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters (count-only,
    /// posture §2). The DEDICATED ConstancyScore + open truth-gaps + repetition
    /// alerts of the reported period, fed to the prompt so the debrief can name
    /// the member's honesty/regularity trajectory in Mark-Douglas terms — never
    /// a market view. Always present (the loader defaults 0/null when no signal).
    verification: verificationSliceSchema,
  })
  .strict();

export type MonthlySnapshot = z.infer<typeof monthlySnapshotSchema>;
