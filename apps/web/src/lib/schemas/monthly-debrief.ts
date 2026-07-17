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

import { habitKindSchema } from '@/lib/schemas/habit-log';
import { normalizeAiTypography } from '@/lib/text/normalize-typography';
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
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
  .transform(normalizeAiTypography);

const safeNarrativeSchema = z
  .string()
  .trim()
  .min(NARRATIVE_MIN_CHARS)
  .max(NARRATIVE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
  .transform(normalizeAiTypography);

const safeSectionSchema = z
  .string()
  .trim()
  .min(SECTION_MIN_CHARS)
  .max(SECTION_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
  .transform(normalizeAiTypography);

const safePatternValueSchema = z
  .string()
  .trim()
  .max(PATTERN_VALUE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
  .transform(normalizeAiTypography);

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
    // Tour 14 — off days in the month window (weekend off + explicit
    // declarations), count-only. `.default(0)` keeps pre-Tour-14 persisted
    // snapshots valid. A jour off is a choice of process, never a missing
    // check-in (§31.2) — the prompt reads it, never scores it as an absence.
    offDaysCount: z.number().int().min(0).default(0),
    sleepHoursMedian: z.number().min(0).max(24).nullable(),
    moodMedian: z.number().min(1).max(10).nullable(),
    stressMedian: z.number().min(1).max(10).nullable(),
    /// SPEC §7.10/§30 — routine & lifestyle signals (count-only, posture §2 —
    /// l'ACTE/la routine, jamais un résultat marché). `null`/0 honnête quand
    /// l'axe n'est pas renseigné (jamais un faux "0"). Axe mode-de-vie/routines
    /// Mark Douglas (§23/§30 — régulation émotionnelle & discipline). Always
    /// present (the aggregator always computes them). Carbon of weekly.
    sleepQualityMedian: z.number().min(1).max(10).nullable(),
    meditationMinMedian: z.number().min(0).nullable(),
    meditationDaysCount: z.number().int().min(0),
    sportDaysCount: z.number().int().min(0),
    gratitudeDaysCount: z.number().int().min(0),
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
    /// Quick win — longest run of consecutive LOSING closed trades in the month
    /// (chronological by `exitedAt`), from `computeMaxConsecutiveLoss`. A break-even
    /// or a win breaks the streak. 0 when no loss streak (or no closed trade). Mark
    /// Douglas grid : a loss streak in a small sample is normal variance, not a
    /// broken edge (5 vérités #1/#3) — surfaced so the debrief names it calmly,
    /// never a market view. Always present (the aggregator always computes it).
    maxConsecutiveLoss: z.number().int().min(0),
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

/// S5 §32-C/D — COACHING. Bloc Markdown PRÉ-RENDU (déterministe, par le moteur
/// `lib/coaching/engine.ts` via `renderCoachingContextSection`) : la synthèse
/// psychologique du membre (axe dominant Mark Douglas + observé/sens/prochain pas
/// + progression MESURÉE + boucles de micro-objectifs refermées sur la période).
/// OPTIONNEL : omis quand la carte mentale est vide. Curé/factuel/numérique ⇒
/// ZÉRO PII et §2-safe par construction (le rendu n'émet jamais de terme de
/// marché — invariant testé côté moteur). Une string (et non un objet structuré)
/// : son SEUL usage est l'injection verbatim dans le prompt, format en un SSOT
/// unique (le moteur), sans second schéma à maintenir en phase.
const coachingSliceSchema = z.string().min(1).max(2000);

// =============================================================================
// (D) Member onboarding profile — REFERENCE read-only context (TASK B)
// =============================================================================

/// SPEC §25.2 — the member's own onboarding profile (their words), surfaced to
/// Claude as REFERENCE CONTEXT for the TEXT only — NEVER fed to scoring/edge
/// (posture §2: progress on the member's OWN entry axes, psycho/process, never
/// a market view). 0 cross-member leak (the loader reads `getProfileForUser`
/// for THIS member only). Truncated by the loader/builder (summary ~600 chars,
/// ≤5 axes, ≤5 highlight labels) + `safeFreeText` re-hardened defense-in-depth
/// (the highlight `evidence[]` verbatim is intentionally DROPPED here — only the
/// short, member-authored labels reach the prompt). `null` = no profile yet
/// (Phase A.2 batch not run / member onboarded pre-feature) → the prompt omits
/// the section (no fabricated axes, §33.6).
const memberProfileSnapshotSchema = z
  .object({
    /// May be empty when the defensive loader coercion found no usable summary
    /// but kept axes/labels — the prompt then skips the summary line only.
    summary: z
      .string()
      .trim()
      .max(600)
      .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
      .transform(safeFreeText),
    /// The member's prioritised entry axes (their words). Capped ≤5; each ≤200.
    axesPrioritaires: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(5),
    /// Durable-trait labels Claude inferred at onboarding (their words). Labels
    /// ONLY — the verbatim `evidence[]` is dropped at the loader boundary so no
    /// raw answer text travels (data minimisation). Capped ≤5; each ≤100.
    highlightLabels: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(5),
    /// D1 (SPEC §25.2) — the member's onboarding COACHING REGISTER, derived by
    /// the loader from `MemberProfile.coachingTone.register` (Zod-validated
    /// there; only the closed enum travels — no free-text, no rationale/evidence).
    /// REFERENCE for the debrief TONE only (`direct` / `pedagogique` /
    /// `socratique`) — NEVER an input of the behavioural score (firewall §21.5).
    /// `null` when absent/malformed → the prompt omits the tone consigne.
    coachingRegister: z.enum(['direct', 'pedagogique', 'socratique']).nullable().optional(),
    /// D1 (SPEC §25.2) — the member's onboarding LEARNING STAGE, derived by the
    /// loader from `MemberProfile.learningStage.stage` (Zod-validated there; only
    /// the closed enum travels). Lets the debrief nuance the register
    /// (`mechanical` / `subjective` / `intuitive`) — NEVER an input of the
    /// behavioural score (firewall §21.5). `null` when absent/malformed.
    learningStage: z.enum(['mechanical', 'subjective', 'intuitive']).nullable().optional(),
  })
  .strict();

// =============================================================================
// (E) Douglas-card usefulness breakdown by category — count-only (TASK E)
// =============================================================================

/// SPEC §28/§30 — per-`cardCategory` "fiche utile" breakdown (count-only,
/// posture §2 — the ACT of finding a card useful, NEVER a market view). One
/// entry per category that had ≥1 card SEEN in the month, frequency-sorted by
/// total-seen desc. `helpful` ≤ `seen` by construction (a card is "useful" only
/// once seen). Empty array when no card was seen. Lets the debrief name the
/// Douglas theme that resonates (discipline / ego / fear…) without any judgement.
const helpfulByCategorySchema = z
  .array(
    z
      .object({
        category: z.string().min(1).max(40),
        helpful: z.number().int().min(0),
        seen: z.number().int().min(0),
      })
      .strict(),
  )
  .max(20);

/// Quick win — distribution of the factual EXIT REASON (`Trade.exitReason`) over
/// the month's CLOSED trades that carry one. One entry per distinct reason, the
/// `label` is the FR wording from `EXIT_REASON_LABELS` (SPEC §2 : how the position
/// ended, never a fault), `count` its frequency, frequency-sorted desc. OPTIONAL :
/// the whole slice is omitted by the aggregator when no closed trade has an
/// exitReason (feature récente — honest empty state, never a fabricated "0").
/// Posture §2 : a factual breakdown of exits, never a market view.
const exitReasonDistributionSchema = z
  .array(
    z
      .object({
        slug: z.enum(['tp_hit', 'sl_hit', 'be_exit', 'manual_before_target', 'time_exit']),
        label: z.string().min(1).max(60),
        count: z.number().int().min(1),
      })
      .strict(),
  )
  .min(1)
  .max(5);

/// Notes membre attachées à ses liens TradingView (`Trade.tradingViewEntryNote`
/// / `tradingViewExitNote`) — l'explication libre que le membre écrit À CÔTÉ de
/// son screen d'entrée / de sortie sur ses trades RÉELS du mois ("ce que je vois
/// / ce que je fais"). Free-text MEMBRE → wrappé untrusted au prompt + `safeFreeText`
/// hardened ici defense-in-depth. Chaque item porte la paire + le sens (context) et
/// le `kind` (entree/sortie) pour situer la note. ≤20 items, recency-sorted, chaque
/// `note` ≤350 chars (loader-truncated). Empty array when the member attached no
/// note. Posture §2 : donnée comportementale auto-déclarée (l'IA la relie aux
/// corrections du coach pour personnaliser le suivi), JAMAIS une instruction ni un
/// avis marché. 🚨 §21.5 — REAL side ONLY : les notes d'ENTRAÎNEMENT (`TrainingTrade.
/// tradingViewNote`) sont isolées et n'entrent JAMAIS dans ce débrief.
export const MEMBER_SCREEN_NOTES_MAX = 20;
export const MEMBER_SCREEN_NOTE_MAX_CHARS = 350;

const memberScreenNotesSchema = z
  .array(
    z
      .object({
        pair: z.string().trim().min(1).max(20),
        direction: z.enum(['long', 'short']),
        kind: z.enum(['entree', 'sortie']),
        note: z
          .string()
          .trim()
          .min(1)
          .max(MEMBER_SCREEN_NOTE_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      })
      .strict(),
  )
  .max(MEMBER_SCREEN_NOTES_MAX);

const pseudonymLabelSchema = z
  .string()
  .regex(/^member-[A-F0-9]{8}$/, 'pseudonymLabel must match member-XXXXXXXX (uppercase hex).');

/**
 * J5.4 — bornes DURES de la slice de continuite N-1 (notre debrief du mois
 * precedent reinjecte). SSOT partagee schema+builder (le builder tronque, le
 * schema `.max()` re-valide). Budget ajoute ~ 600 + 3x200 ~ 1,2 KB / membre*mois.
 */
export const PREVIOUS_DEBRIEF_SUMMARY_MAX_CHARS = 600;
export const PREVIOUS_DEBRIEF_RECO_MAX_CHARS = 200;
export const PREVIOUS_DEBRIEF_RECO_MAX_ITEMS = 3;

/**
 * J5.1 — bornes DURES de la slice « reflexions ABCD » (CBT Ellis : A declencheur,
 * B croyance, C consequence, D recadrage). Free-text MEMBRE -> rendu untrusted au
 * prompt. On borne aux N plus recentes du mois, chaque champ tronque a M chars
 * (source : 2000 max au write ; 240 = signal, pas l'essai complet). Budget ajoute
 * ~ 3 x 4 x 240 ~ 2,9 KB / membre*mois. SSOT partagee schema+builder.
 */
export const REFLECTION_PROMPT_MAX_ENTRIES = 3;
export const REFLECTION_FIELD_MAX_CHARS = 240;

/**
 * J5.7 — bornes DURES de la slice « objectifs de process » (anneaux 0-100, axe de
 * coaching hebdo, objectif de methode derive). Anneaux = 4 dimensions (structural).
 * Champs texte (coachingAxis AI-derived, methodGoal deterministe) tronques a M
 * chars + `safeFreeText`. SSOT partagee schema+builder. Budget minuscule (~1 KB).
 */
export const OBJECTIVES_RING_MAX = 4;
export const OBJECTIVES_TEXT_MAX_CHARS = 200;

/**
 * J5.8 — bornes DURES de la slice « fiches Mark Douglas favorites » (titre +
 * categorie). N = 5 favoris les plus recents ; titre <= M chars (headlines courts,
 * safeFreeText). Titre = contenu ADMIN curated, rendu wrapped untrusted au prompt.
 * SSOT partagee schema+builder. Budget minuscule (~0,6 KB/membre*rapport).
 */
export const FAVORITES_PROMPT_MAX_ENTRIES = 5;
export const FAVORITE_TITLE_MAX_CHARS = 120;

/**
 * J5.4 — slice « debrief du mois precedent (N-1) » : NOTRE propre sortie IA du
 * mois dernier (`summaryReal` cote REEL uniquement — §21.5, jamais le training —
 * + les `recommendations`), reinjectee BORNEE pour la continuite du suivi.
 * `safeFreeText` + `.max()` = defense-in-depth (contenu deja valide au write mais
 * member-derived). `.strict()` rejette tout champ non declare.
 */
const previousDebriefSchema = z
  .object({
    monthStart: z.date(),
    summaryReal: z
      .string()
      .trim()
      .min(1)
      .max(PREVIOUS_DEBRIEF_SUMMARY_MAX_CHARS)
      .refine((s) => !containsBidiOrZeroWidth(s), 'Caracteres de controle interdits.')
      .transform(safeFreeText),
    recommendations: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(PREVIOUS_DEBRIEF_RECO_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caracteres de controle interdits.')
          .transform(safeFreeText),
      )
      .max(PREVIOUS_DEBRIEF_RECO_MAX_ITEMS),
  })
  .strict();

/**
 * J5.1 — champ ABCD borne partage (A/B/C/D). Free-text MEMBRE : `safeFreeText`
 * + `.max()` defense-in-depth (deja borne au write 10-2000, re-borne ici a M).
 */
const reflectionFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(REFLECTION_FIELD_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caracteres de controle interdits.')
  .transform(safeFreeText);

/**
 * J5.1 — slice « reflexions ABCD recentes » : les entrees CBT (Ellis) du membre
 * sur le mois (A/B/C/D), bornees aux N plus recentes, chaque champ <= M chars.
 * Free-text MEMBRE -> rendu untrusted au prompt boundary. `.strict()` rejette
 * tout champ non declare.
 */
const reflectionSliceSchema = z
  .object({
    date: z.string().min(1).max(40),
    triggerEvent: reflectionFieldSchema,
    beliefAuto: reflectionFieldSchema,
    consequence: reflectionFieldSchema,
    disputation: reflectionFieldSchema,
  })
  .strict();

/**
 * J5.7 — champ texte borne des objectifs (axe de coaching / libelle+hint de
 * methodGoal). `safeFreeText` + `.max()` defense-in-depth. min(1) : le builder
 * null-ifie tout champ vide avant qu'il n'atteigne le schema.
 */
const objectivesTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(OBJECTIVES_TEXT_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caracteres de controle interdits.')
  .transform(safeFreeText);

/**
 * J5.7 — un anneau d'objectif de process (une dimension comportementale : score
 * actuel 0-100 ou null, cible, atteinte). Libelle FIXE (DIMENSION_META).
 */
const objectiveRingSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    current: z.number().int().min(0).max(100).nullable(),
    target: z.number().int().min(0).max(100),
    reached: z.boolean(),
  })
  .strict();

/**
 * J5.7 — slice « objectifs de process » : les anneaux (<=4), l'axe de coaching de
 * la semaine (AI-derived, nullable), l'objectif de methode derive (deterministe,
 * nullable). Contexte DESCRIPTIF (posture §2). `.strict()` rejette tout extra.
 */
const objectivesSliceSchema = z
  .object({
    rings: z.array(objectiveRingSchema).max(OBJECTIVES_RING_MAX),
    coachingAxis: objectivesTextSchema.nullable(),
    methodGoal: z
      .object({
        label: objectivesTextSchema,
        hint: objectivesTextSchema,
        current: z.number().int().min(0).max(100),
        target: z.number().int().min(0).max(100),
      })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * J5.8 — une fiche Mark Douglas mise en favori (titre + categorie). Titre =
 * contenu ADMIN curated ; borne + safeFreeText au builder, rendu wrapped untrusted
 * au prompt (defense-in-depth). `.strict()` rejette tout champ non declare.
 */
const favoriteCardSchema = z
  .object({
    title: z.string().trim().min(1).max(FAVORITE_TITLE_MAX_CHARS),
    category: z.string().trim().min(1).max(40),
  })
  .strict();

/**
 * J5.2 — one TRACK pillar summarised for the prompt: the average of the pillar's
 * scalar over the window (`extractHabitScalar`) + the number of days logged.
 * `kind` = HabitKind enum ; `unit` = the scalar's unit. Aggregated + bounded by
 * the pure builder. `.strict()` rejects any undeclared field.
 */
const habitPillarSchema = z
  .object({
    kind: habitKindSchema,
    daysLogged: z.number().int().min(1),
    average: z.number().min(0),
    unit: z.enum(['h', 'min', 'repas', 'cafés']),
  })
  .strict();

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
    /// S5 §32-C/D — synthèse de coaching psychologique pré-rendue (optionnelle).
    coaching: coachingSliceSchema.optional(),
    /// TASK B (SPEC §25.2) — the member's onboarding profile (their words),
    /// REFERENCE context for the TEXT only (never scoring/edge — posture §2).
    /// `null` when no profile yet → the prompt omits the section.
    memberProfile: memberProfileSnapshotSchema.nullable(),
    /// TASK D — recent member journal verbatim (auto-declared free-text), ≤10
    /// excerpts, recency-sorted, `safeFreeText` + truncated ~200 chars by the
    /// builder (carbon weekly `collectJournalExcerpts`). DATA, never instructions
    /// (wrapped untrusted at the prompt boundary). Empty array when no journal.
    journalExcerpts: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(WEEKLY_CONTEXT_ITEM_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(10),
    /// TASK A — recent member MORNING intentions (auto-declared free-text, the
    /// MATIN twin of `journalExcerpts`), ≤10 entries, recency-sorted,
    /// `safeFreeText` + truncated ~200 chars by the builder. DATA, never
    /// instructions (wrapped untrusted at the prompt boundary). Empty array when
    /// no morning intention. Mark Douglas material (intention vs execution).
    morningIntentions: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(WEEKLY_CONTEXT_ITEM_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(10),
    /// TASK E (SPEC §28/§30) — per-category "fiche utile" breakdown (count-only,
    /// posture §2). Lets the debrief calmly name the Douglas theme that resonates
    /// (discipline / ego / fear…) without any judgement. Empty when none seen.
    helpfulByCategory: helpfulByCategorySchema,
    /// J-AI corrections echo — the coach's own corrections on the member's REAL
    /// trades this month, each pre-formatted by the loader as `« Axe » : commentaire`
    /// (the axis label prefixes the correction so the debrief can theme them). REAL
    /// side only: training corrections are §21.5-isolated and NEVER reach this
    /// pipeline (the monthly loader may read only `countRecentTrainingActivity`).
    /// The comment is an ADMIN free-text (not member self-declaration), so it is
    /// still wrapped untrusted at the prompt boundary + `safeFreeText`-hardened
    /// here defense-in-depth. ≤20 entries, recency-sorted, each ≤350 chars
    /// (loader-truncated). Empty array when the coach tagged no correction.
    coachCorrections: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(WEEKLY_CONTEXT_ITEM_MAX_CHARS)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(20),
    /// Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    /// trades RÉELS du mois — l'explication que le membre écrit à côté de son screen.
    /// Donnée comportementale auto-déclarée (l'IA la relie aux corrections du coach
    /// pour personnaliser le suivi), JAMAIS une instruction ni un avis marché. ≤20
    /// items, recency-sorted, chaque `note` ≤350 chars. Empty array when the member
    /// attached no note. REAL side only (§21.5 keeps training notes out entirely).
    memberScreenNotes: memberScreenNotesSchema,
    /// Quick win — factual distribution of the month's closed-trade exit reasons
    /// (`Trade.exitReason`). OPTIONAL : omitted when no closed trade carried an
    /// exitReason (feature récente — honest empty state). Posture §2 (factual).
    exitReasonDistribution: exitReasonDistributionSchema.optional(),
    /// J5.4 — continuite N-1 : rappel BORNE de notre debrief du mois precedent
    /// (REEL only §21.5). Absent -> le prompt omet le bloc (retrocompat totale).
    previousDebrief: previousDebriefSchema.optional(),
    /// J5.1 — reflexions ABCD recentes du membre (CBT Ellis), bornees aux N plus
    /// recentes. Free-text MEMBRE -> rendu untrusted au prompt. Toujours present
    /// (array vide si aucune -> le prompt omet la section, retrocompat).
    reflections: z.array(reflectionSliceSchema).max(REFLECTION_PROMPT_MAX_ENTRIES),
    /// J5.7 — objectifs de process (anneaux + axe de coaching + objectif de
    /// methode), issus du SSOT `getProcessObjectives`. Absent -> le prompt omet
    /// la section (retrocompat, aucune cible fabriquee). Posture §2 (descriptif).
    objectives: objectivesSliceSchema.optional(),
    /// J5.8 — fiches Mark Douglas mises en favori par le membre (titre + categorie),
    /// via le SSOT `listMyFavorites`. Absent -> le prompt omet la section
    /// (retrocompat). Titres wrapped untrusted au prompt. Posture §2 (psycho).
    favorites: z.array(favoriteCardSchema).max(FAVORITES_PROMPT_MAX_ENTRIES).optional(),
    /// J5.2 — piliers TRACK (HabitLog) resumes COUNT-ONLY : par pilier logge, la
    /// moyenne du scalaire (sommeil h / sport + meditation min / nutrition repas /
    /// cafeine tasses) + le nombre de jours loggés sur la fenetre. Agrege par le
    /// builder pur, borne a 5 (taille de l'enum HabitKind). Absent -> le prompt omet
    /// la section (retrocompat). Posture §2 (hygiene de vie), hors firewall §21.5.
    habits: z.array(habitPillarSchema).max(5).optional(),
  })
  .strict();

export type MonthlySnapshot = z.infer<typeof monthlySnapshotSchema>;
