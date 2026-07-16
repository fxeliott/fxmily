/**
 * Zod schemas for `WeeklyReport` (J8 — Phase A foundation).
 *
 * Three layers:
 *   - `weeklyReportInputSchema`  — what the builder produces from DB data,
 *                                  fed to Claude Sonnet 4.6 as user prompt.
 *   - `weeklyReportOutputSchema` — what Claude is expected to return (JSON
 *                                  strict). Validated post-`messages.parse()`
 *                                  in double-net (enum fuzzing defense).
 *   - `weeklyReportPersistedSchema` — what we write to the DB (combines
 *                                  output + cost metrics + dispatch state).
 *
 * Hardening :
 *   - `safeFreeText` (NFC + bidi/zero-width strip) on every free-text field
 *     that originates from member input. **CRITIQUE** for prompt injection
 *     defense (Trojan Source) before sending to Claude (J5 audit M5 + J7
 *     carbone).
 *   - `summary` / risks / recommendations also pass through `safeFreeText`
 *     post-Claude — defense-in-depth in case Claude ever returns content
 *     with bidi/zero-width control chars.
 *   - `.strict()` on output schema rejects any extra keys the LLM might
 *     hallucinate.
 *   - `risks` / `recommendations` capped at max 5 items, each 20-300 chars.
 *
 * Note: this file is **server-only** at import time only insofar as it
 * imports `@/lib/text/safe`. Both should already be on the server boundary;
 * no client component imports them.
 */

import { z } from 'zod';

import { normalizeAiTypography } from '@/lib/text/normalize-typography';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

// =============================================================================
// Constants
// =============================================================================

export const SUMMARY_MIN_CHARS = 100;
export const SUMMARY_MAX_CHARS = 800;
export const ITEM_MIN_CHARS = 20;
export const ITEM_MAX_CHARS = 300;
export const RISKS_MIN = 0;
export const RISKS_MAX = 5;
export const RECOMMENDATIONS_MIN = 1;
export const RECOMMENDATIONS_MAX = 5;
export const PATTERN_VALUE_MAX_CHARS = 400;
/**
 * J5.3 — dedicated ceiling for the 5 member weekly-review free-text answers
 * (biggestWin, biggestMistake, bestPractice, lessonLearned, nextWeekFocus).
 * Separate from PATTERN_VALUE_MAX_CHARS (shared by the short derived patterns +
 * journalExcerpts + morningIntentions, which must stay tight). 2000 chars ≈ 350
 * words carries a whole real review answer (the old 300 cap truncated
 * mid-sentence); stays 2× under the DB ceiling REVIEW_TEXT_MAX_CHARS=4000.
 * Loader + builder align to this single constant (import = one source of truth).
 */
export const MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS = 2000;

/**
 * J5.1 — bornes DURES de la slice « reflexions ABCD » (CBT Ellis : A declencheur,
 * B croyance, C consequence, D recadrage) cote HEBDO. Free-text MEMBRE -> rendu
 * untrusted au prompt. N plus recentes de la semaine, chaque champ <= M chars
 * (source : 2000 max au write ; 240 = signal, pas l'essai complet). SSOT partagee
 * schema+builder. Twin des bornes du debrief mensuel.
 */
export const REFLECTION_PROMPT_MAX_ENTRIES = 3;
export const REFLECTION_FIELD_MAX_CHARS = 240;

// Free-text item — free-form string with anti-injection hardening.
const safeItemSchema = z
  .string()
  .trim()
  .min(ITEM_MIN_CHARS)
  .max(ITEM_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — strip em/en dashes from Claude output
  // before it is persisted / shown to a member. AI output only (not member input).
  .transform(normalizeAiTypography);

const safeSummarySchema = z
  .string()
  .trim()
  .min(SUMMARY_MIN_CHARS)
  .max(SUMMARY_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — strip em/en dashes from Claude output
  // before it is persisted / shown to a member. AI output only (not member input).
  .transform(normalizeAiTypography);

const safePatternValueSchema = z
  .string()
  .trim()
  .max(PATTERN_VALUE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — strip em/en dashes from Claude output
  // before it is persisted / shown to a member. AI output only (not member input).
  .transform(normalizeAiTypography);

// J5.3 — exact mirror of safePatternValueSchema (same trim + bidi/zero-width
// refine + safeFreeText + typography belt), only the .max() ceiling differs.
// Dedicated to the 5 member weekly-review answers so they can carry a whole
// real review (2000 chars) without loosening PATTERN_VALUE_MAX_CHARS.
const safeMemberWeeklyReviewValueSchema = z
  .string()
  .trim()
  .max(MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — strip em/en dashes from Claude output
  // before it is persisted / shown to a member. AI output only (not member input).
  .transform(normalizeAiTypography);

// =============================================================================
// Patterns object — what the builder summarizes from analytics
// =============================================================================

/// Patterns extracted from the 7-day window. All optional — the builder may
/// omit a pattern when sample size is insufficient (cf. J6 sample-size guards).
export const weeklyReportPatternsSchema = z
  .object({
    /// Emotion → outcome pattern (ex: "FOMO win rate 23% vs Calme 67% sur 14 trades").
    emotionPerf: safePatternValueSchema.optional(),
    /// Sleep × performance pattern (ex: "<6h sommeil → -0.4R moyen sur 5 trades").
    sleepPerf: safePatternValueSchema.optional(),
    /// Session focus pattern (ex: "78% trades en session London cette semaine").
    sessionFocus: safePatternValueSchema.optional(),
    /// Discipline trajectory (ex: "Plan respect rate 82% (vs 71% semaine -1)").
    disciplineTrend: safePatternValueSchema.optional(),
  })
  .strict();

export type WeeklyReportPatterns = z.infer<typeof weeklyReportPatternsSchema>;

// =============================================================================
// Output schema — what Claude must return (JSON strict)
// =============================================================================

/// What we expect Claude Sonnet 4.6 to return via `output_config.format`.
/// Validated TWICE: once at SDK level via the structured-output schema, once
/// post-`messages.parse()` here as a double-net against enum fuzzing or
/// formatting drift.
export const weeklyReportOutputSchema = z
  .object({
    summary: safeSummarySchema,
    risks: z.array(safeItemSchema).min(RISKS_MIN).max(RISKS_MAX),
    recommendations: z.array(safeItemSchema).min(RECOMMENDATIONS_MIN).max(RECOMMENDATIONS_MAX),
    patterns: weeklyReportPatternsSchema,
  })
  .strict();

export type WeeklyReportOutput = z.infer<typeof weeklyReportOutputSchema>;

// =============================================================================
// Cost-tracking schema — what we persist alongside output
// =============================================================================

export const weeklyReportCostSchema = z
  .object({
    claudeModel: z.string().min(4).max(80),
    inputTokens: z.number().int().min(0).max(2_000_000),
    outputTokens: z.number().int().min(0).max(50_000),
    cacheReadTokens: z.number().int().min(0).max(2_000_000).default(0),
    cacheCreateTokens: z.number().int().min(0).max(2_000_000).default(0),
    /// Cost in EUR with 6 decimals precision (sub-cent tracking, SPEC §16).
    costEur: z
      .union([z.number(), z.string()])
      .transform((v) => (typeof v === 'string' ? v : v.toFixed(6))),
  })
  .strict();

export type WeeklyReportCost = z.infer<typeof weeklyReportCostSchema>;

// =============================================================================
// Persisted schema — combines output + cost + dispatch (DB write)
// =============================================================================

export const weeklyReportPersistInputSchema = weeklyReportOutputSchema.extend({
  userId: z.string().min(1).max(64),
  weekStart: z.date(),
  weekEnd: z.date(),
  cost: weeklyReportCostSchema,
});

export type WeeklyReportPersistInput = z.infer<typeof weeklyReportPersistInputSchema>;

// =============================================================================
// Snapshot schema — what the builder produces from DB (input to Claude)
// =============================================================================

/// Counters slice — pure numerics, never user-controlled text.
const counterSliceSchema = z
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
    /// present (the builder always computes the split).
    realizedRReliability: z
      .object({
        computed: z.number().int().nonnegative(),
        estimated: z.number().int().nonnegative(),
      })
      .strict(),
    planRespectRate: z.number().min(0).max(1).nullable(),
    hedgeRespectRate: z.number().min(0).max(1).nullable(),
    /// SPEC §28/§21 — Session-2 process/habit axes as EXPLICIT NAMED COUNTERS
    /// (count-only behavioural rates, posture §2 — they measure the ACT, never
    /// P&L), so the autonomous Claude analyses can reason on each axis BY NAME
    /// instead of only via the rolled-up discipline/engagement scores. Each is
    /// `true / answered` over the window, `null` when nobody answered (no fake
    /// "0 %", mirror `planRespectRate`). Always present (the builder always
    /// computes them) — additive to the snapshot.
    ///   - `processCompleteRate` ("oublis") : closed trades, `processComplete`.
    processCompleteRate: z.number().min(0).max(1).nullable(),
    ///   - `formationFollowedRate` : evenings, `formationFollowed`.
    formationFollowedRate: z.number().min(0).max(1).nullable(),
    ///   - `marketAnalysisDoneRate` : mornings, `marketAnalysisDone`.
    marketAnalysisDoneRate: z.number().min(0).max(1).nullable(),
    ///   - `morningRoutineCompletedRate` : mornings, `morningRoutineCompleted`.
    morningRoutineCompletedRate: z.number().min(0).max(1).nullable(),
    /// `meetingAttendance` — completed / scheduled Fxmily meetings in the
    /// window (count-only primitive `countMeetingAttendance`, §30.4). `rate`
    /// is `null` when `scheduled === 0` (honest empty state, never a fake "0 %").
    meetingAttendance: z
      .object({
        scheduled: z.number().int().min(0),
        completed: z.number().int().min(0),
        rate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    morningCheckinsCount: z.number().int().min(0),
    eveningCheckinsCount: z.number().int().min(0),
    /// Tour 14 — number of OFF days (weekend kept off + explicit declarations)
    /// inside the report window. Count-only (posture §2). Surfaced in the prompt
    /// so the AI reads a jour off as a CHOICE of process, never a missing
    /// check-in (§31.2). `.default(0)` so historical persisted snapshots (written
    /// before Tour 14, without the field) re-parse — the report text persists,
    /// only the fresh snapshot carries the count.
    offDaysCount: z.number().int().min(0).default(0),
    streakDays: z.number().int().min(0),
    sleepHoursMedian: z.number().min(0).max(24).nullable(),
    moodMedian: z.number().min(1).max(10).nullable(),
    stressMedian: z.number().min(1).max(10).nullable(),
    /// SPEC §7.10/§30 — routine & lifestyle signals (count-only, posture §2 —
    /// l'ACTE/la routine, jamais un résultat marché). `null`/0 honnête quand
    /// l'axe n'est pas renseigné (jamais un faux "0"). Axe mode-de-vie/routines
    /// Mark Douglas (§23/§30 — régulation émotionnelle & discipline). Always
    /// present (the builder always computes them). Carbon of monthly.
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
    /// SPEC §21 J-T4 — "volume de pratique" : backtest sessions in the report
    /// week. 🚨 §21.5: a pure non-negative integer (effort/volume). The
    /// `.strict()` on this object structurally rejects any P&L key (e.g.
    /// `resultR`) the builder might erroneously try to add.
    trainingSessionsCount: z.number().int().min(0),
    /// V1.5 — Steenbarger setup quality distribution. Counts trades whose
    /// quality was captured (NULL trades excluded from the distribution).
    /// `tradesQualityCaptured` is the denominator for ratio analysis.
    tradesQualityA: z.number().int().min(0),
    tradesQualityB: z.number().int().min(0),
    tradesQualityC: z.number().int().min(0),
    tradesQualityCaptured: z.number().int().min(0),
    /// V1.5 — Tharp risk %. Median over trades that captured the field.
    /// `riskPctOverTwoCount` surfaces over-2 % violations (Tharp ceiling).
    riskPctMedian: z.number().min(0).max(100).nullable(),
    riskPctOverTwoCount: z.number().int().min(0),
    /// Quick win — longest run of consecutive LOSING closed trades in the window
    /// (chronological by `exitedAt`), from `computeMaxConsecutiveLoss`. A break-even
    /// or a win breaks the streak. 0 when no loss streak (or no closed trade). Mark
    /// Douglas grid : a 3-loss streak in a small sample is normal variance, not a
    /// broken edge (5 vérités #1/#3) — surfaced so Claude names it calmly, never a
    /// market view. Always present (the builder always computes it).
    maxConsecutiveLoss: z.number().int().min(0),
  })
  .strict();

/// Free-text slice — sanitized via safeFreeText before snapshot leaves the
/// builder. ALL strings here MUST pass through safeFreeText (this schema
/// enforces it via .transform). The builder must NOT bypass this for any
/// member-controlled text (journalNote, intention, sportType, gratitudes).
/**
 * J5.1 — champ ABCD borne partage (A/B/C/D) cote hebdo. Free-text MEMBRE :
 * `safeFreeText` + `.max()` defense-in-depth (deja borne au write 10-2000).
 */
const reflectionFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(REFLECTION_FIELD_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/**
 * J5.1 — slice « reflexions ABCD recentes » (CBT Ellis) du membre sur la semaine,
 * bornee aux N plus recentes, chaque champ <= M chars. Free-text MEMBRE -> rendu
 * untrusted au prompt. `.strict()` rejette tout champ non declare.
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

const freeTextSliceSchema = z
  .object({
    /// Top emotion tags observed this week (deduped, frequency-sorted).
    emotionTags: z.array(z.string().trim().min(1).max(40)).max(20),
    /// D3-01 — post-outcome behavioural bias tags (CFA LESSOR + Steenbarger:
    /// revenge-trade, loss-aversion, overconfidence…) declared on the week's
    /// trades, frequency-sorted, capped at 12. Carried as `{ tag, count }` (vs
    /// the bare-string `emotionTags`) so the prompt can render `tag×count`.
    /// PSYCHOLOGICAL self-declarations (posture §2 — never a market signal).
    /// Empty array when no trade carried a bias tag.
    behaviorTags: z
      .array(
        z
          .object({
            tag: z.string().trim().min(1).max(40),
            count: z.number().int().min(1),
          })
          .strict(),
      )
      .max(12),
    /// Top trading pairs traded this week (frequency-sorted).
    pairsTraded: z.array(z.string().trim().min(1).max(20)).max(10),
    /// Sessions traded (asia / london / overlap / newyork) with counts.
    sessionsTraded: z
      .array(
        z.object({
          session: z.enum(['asia', 'london', 'newyork', 'overlap']),
          count: z.number().int().min(0),
        }),
      )
      .max(4),
    /// Sample of journal note excerpts — already safeFreeText-sanitized.
    journalExcerpts: z.array(safePatternValueSchema).max(5),
    /// TASK A — recent member MORNING intentions (auto-declared free-text, the
    /// MATIN twin of `journalExcerpts`), recency-sorted, ≤5, already
    /// safeFreeText-sanitized + truncated ~200 chars by the builder. DATA, never
    /// instructions (wrapped untrusted at the prompt boundary). Empty when no
    /// morning intention. Mark Douglas material (intention vs execution).
    morningIntentions: z.array(safePatternValueSchema).max(5),
    /// V1.8 REFLECT — the member's own weekly-review answers (their words about
    /// their week), builder re-hardened (trim + truncate + safeFreeText) then
    /// re-validated here (`safeMemberWeeklyReviewValueSchema` = bidi refine +
    /// safeFreeText + typography, ceiling MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS =
    /// 2000 so a whole real answer survives — J5.3). `bestPractice` is the
    /// wizard's only optional answer → honest `null`. Optional: absent when the
    /// member submitted no review (honest empty state — historical snapshots
    /// re-parse unchanged).
    memberWeeklyReview: z
      .object({
        biggestWin: safeMemberWeeklyReviewValueSchema,
        biggestMistake: safeMemberWeeklyReviewValueSchema,
        bestPractice: safeMemberWeeklyReviewValueSchema.nullable(),
        lessonLearned: safeMemberWeeklyReviewValueSchema,
        nextWeekFocus: safeMemberWeeklyReviewValueSchema,
      })
      .strict()
      .optional(),
    /// J5.1 — reflexions ABCD recentes du membre (CBT Ellis), bornees aux N plus
    /// recentes. Free-text MEMBRE -> rendu untrusted au prompt. Toujours present
    /// (array vide si aucune -> le prompt omet la section, retrocompat).
    reflections: z.array(reflectionSliceSchema).max(REFLECTION_PROMPT_MAX_ENTRIES),
  })
  .strict();

/**
 * V1.5 pseudonymization — the snapshot sent to Claude carries a stable but
 * non-reversible label (`pseudonymLabel`) instead of the raw `userId` UUID.
 *
 * **V1.5.2 rename + 32-bit widening** :
 *   - Renamed from `memberLabel` to `pseudonymLabel` to disambiguate from
 *     the J8 display name `WeeklyDigestEmail.memberLabel` ("Sophie Martin"
 *     or "Membre #abc123") which lives at a different layer and never
 *     crosses the prompt boundary. Two distinct concepts now have two
 *     distinct names — fail-fast at code-review when a future dev would
 *     have wired them up swapped.
 *   - Hash truncated from 24 bits (6 hex) to 32 bits (8 hex). Birthday
 *     50 % collision threshold goes from ~4,823 members (V1.5) to ~77,163
 *     members (V1.5.2) — sufficient through V2 launch without re-migration.
 *
 * Rationale (defense-in-depth, Phase V audit):
 *   - The cuid `userId` is not directly PII (no email, no name) but it is
 *     system-identifying and ends up serialized in Anthropic API logs +
 *     potentially in `WeeklyReport.summary` if Claude ever copy-pastes it
 *     into the output.
 *   - `member-${SHA-256(userId)[0..8].toUpperCase()}` is :
 *       - deterministic (same userId → same label, no DB schema change)
 *       - non-reversible without a precomputed rainbow table
 *       - human-readable in admin reports ("member-A1B2C3D4" vs a 25-char cuid)
 *       - collision-free for cohorts up to ~4.3 G members (32-bit space)
 *   - The DB row `WeeklyReport.userId` keeps the FK — pseudonymization is
 *     a *prompt boundary* concern, not a *persistence* concern.
 *
 * The internal `BuilderInput.userId` (in `lib/weekly-report/types.ts`) stays
 * as the cuid — only the externally-visible snapshot loses it.
 */
/// Notes membre attachées à ses liens TradingView (`Trade.tradingViewEntryNote`
/// / `tradingViewExitNote`) — l'explication libre que le membre écrit À CÔTÉ de
/// son screen d'entrée / de sortie. C'est une lecture de son PROPRE screen ("ce
/// que je vois / ce que je fais"), du free-text MEMBRE → wrappé untrusted au
/// prompt + `safeFreeText`-hardened ici defense-in-depth. Chaque item porte la
/// paire + le sens (context) et le `kind` (entree/sortie) pour situer la note.
/// ≤20 items, recency-sorted, chaque `note` ≤350 chars (loader-truncated). Empty
/// array when the member attached no note. Posture §2 : c'est une donnée
/// comportementale auto-déclarée (l'IA s'en sert pour relier ce que le membre
/// voit à ce que le coach corrige), JAMAIS une instruction ni un avis marché.
/// 🚨 §21.5 — REAL side ONLY : les notes d'ENTRAÎNEMENT (`TrainingTrade.
/// tradingViewNote`) sont isolées et n'entrent JAMAIS dans ce rapport.
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

/// (S3) VÉRIFICATION & CONSTANCE — Session 3 (DOD3-01, DoD#2 S6). COUNT-ONLY,
/// posture §2/§33.2 : des nombres factuels (jamais un compteur de culpabilité,
/// jamais un avis marché). `constancy` est le **ConstancyScore S3 DÉDIÉ**
/// (honnêteté/régularité/discipline confrontées à la réalité MT5), STRICTEMENT
/// DISTINCT du sous-score `consistency` de `BehavioralScore` (S2/S5, `scores`
/// ci-dessous). `null` quand le membre n'a aucun signal de constance sur la
/// semaine rapportée (pas de faux score neutre — anti-complaisance §33.6).
/// `constancy` + `alertCount` sont period-scopés ; `openDiscrepancyCount` =
/// écarts de vérité encore OUVERTS (« à regarder ») = état COURANT (point-in-time,
/// non period-scopé). `alertCount` = alertes PSYCHOLOGIQUES déclenchées dans la
/// semaine (répétition uniquement §33.8 — `Alert.category` est l'enum mono-valeur
/// `psychological`).
const verificationSliceSchema = z
  .object({
    constancy: z
      .object({
        value: z.number().min(0).max(100),
        honesty: z.number().min(0).max(100).nullable(),
        regularity: z.number().min(0).max(100).nullable(),
        discipline: z.number().min(0).max(100).nullable(),
      })
      .strict()
      .nullable(),
    openDiscrepancyCount: z.number().int().min(0),
    alertCount: z.number().int().min(0),
  })
  .strict();

/// (S15 #7) PATTERN SIGNALS — behaviour→outcome cross-cuts the autonomous run
/// previously never received (it saw counters only). Every field is OPTIONAL and
/// SAMPLE-GATED by the builder: a sub-signal is present ONLY when its honest
/// sample threshold is met (≥ HOURLY_MIN_SAMPLE etc.), so Claude never reasons on
/// a win-rate over 1 trade. Posture §2: emotion/hour/discipline cross-cuts and
/// composure/momentum — psychological & process patterns, NEVER a market view.
/// `.strict()` structurally rejects any stray P&L key. The whole slice is
/// optional → omitted entirely when nothing clears its threshold (zero noise).
const patternSignalsSchema = z
  .object({
    /// Top ENTRY emotion by trade volume (n ≥ sample gate). winRatePct null when
    /// the win-rate is not honestly reportable.
    topEntryEmotion: z
      .object({
        slug: z.string().min(1).max(40),
        trades: z.number().int().min(0),
        winRatePct: z.number().int().min(0).max(100).nullable(),
      })
      .strict()
      .optional(),
    /// Most-traded entry-hour band (trades ≥ HOURLY_MIN_SAMPLE).
    topHourBand: z
      .object({
        slot: z.enum(['night', 'morning', 'afternoon', 'evening']),
        label: z.string().min(1).max(40),
        trades: z.number().int().min(0),
        winRatePct: z.number().int().min(0).max(100),
        avgR: z.number(),
      })
      .strict()
      .optional(),
    /// Intra-trade composure loss (entered serene → exited contrarié). Present
    /// only at/above the calm surfacing threshold.
    emotionArc: z
      .object({
        count: z.number().int().min(0),
        considered: z.number().int().min(0),
      })
      .strict()
      .optional(),
    /// Sustained multi-week declines per dimension (calm momentum signal — the
    /// "your stability has been drifting" cross-cut). Empty array omitted.
    momentumDeclines: z
      .array(
        z
          .object({
            dimension: z.enum(['discipline', 'emotionalStability', 'consistency', 'engagement']),
            label: z.string().min(1).max(40),
            weeklySlope: z.number(),
            points: z.number().int().min(0),
          })
          .strict(),
      )
      .max(4)
      .optional(),
  })
  .strict();

export type WeeklyPatternSignals = z.infer<typeof patternSignalsSchema>;

/// S5 §32-C/D — COACHING. Bloc Markdown PRÉ-RENDU (déterministe, par le moteur
/// `lib/coaching/engine.ts` via `renderCoachingContextSection`) : la synthèse
/// psychologique du membre (axe dominant Mark Douglas + observé/sens/prochain pas
/// + progression MESURÉE + boucles de micro-objectifs refermées). OPTIONNEL :
/// omis quand le membre n'a aucun signal mental à synthétiser (carte mentale
/// vide). Curé/factuel/numérique ⇒ ZÉRO PII et §2-safe par construction (le
/// rendu n'émet jamais de terme de marché — invariant testé côté moteur). Une
/// string et non un objet structuré : son SEUL usage est l'injection verbatim
/// dans le prompt, et le format vit en un point unique (le moteur), sans second
/// SSOT à maintenir en phase.
const coachingSliceSchema = z.string().min(1).max(2000);

/// Quick win — distribution of the factual EXIT REASON (`Trade.exitReason`) over
/// the week's CLOSED trades that carry one. One entry per distinct reason, the
/// `label` is the FR wording from `EXIT_REASON_LABELS` (SPEC §2 : how the position
/// ended, never a fault), `count` its frequency, frequency-sorted desc. OPTIONAL :
/// the whole slice is omitted by the builder when no closed trade has an exitReason
/// (feature récente — honest empty state, never a fabricated "0"). Posture §2 : a
/// factual breakdown of exits, never a market view. `.strict()` rejects stray keys.
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

export const weeklySnapshotSchema = z
  .object({
    pseudonymLabel: pseudonymLabelSchema,
    timezone: z.string().min(3).max(60),
    weekStart: z.date(),
    weekEnd: z.date(),
    counters: counterSliceSchema,
    freeText: freeTextSliceSchema,
    /// S15 #7 — behaviour→outcome pattern cross-cuts (sample-gated, optional).
    patternSignals: patternSignalsSchema.optional(),
    /// Behavioral score snapshot from `lib/scoring`. Null = `insufficient_data`.
    scores: z
      .object({
        discipline: z.number().int().min(0).max(100).nullable(),
        emotionalStability: z.number().int().min(0).max(100).nullable(),
        consistency: z.number().int().min(0).max(100).nullable(),
        engagement: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    /// DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters (count-only,
    /// posture §2). The DEDICATED ConstancyScore + repetition alerts of the
    /// reported week are period-scoped; the open-truth-gaps count is current-state
    /// (still open now). Fed to the admin digest so Eliott sees each member's
    /// honesty/regularity trajectory — never a market view. Always present (the
    /// loader defaults 0/null when no signal).
    verification: verificationSliceSchema,
    /// S5 §32-C/D — synthèse de coaching psychologique pré-rendue (optionnelle).
    coaching: coachingSliceSchema.optional(),
    /// Quick win — factual distribution of the week's closed-trade exit reasons
    /// (`Trade.exitReason`). OPTIONAL : omitted when no closed trade carried an
    /// exitReason (feature récente — honest empty state). Posture §2 (factual).
    exitReasonDistribution: exitReasonDistributionSchema.optional(),
    /// Quick win — the coach's TAGGED corrections on this member's REAL trades this
    /// week, each pre-formatted by the loader as `« Axe » : commentaire` (the axis
    /// label prefixes the correction so the report can theme them). This is THE
    /// report the coach reads, so his own corrections belong in it (parity with the
    /// monthly debrief). ADMIN free-text → wrapped untrusted at the prompt boundary
    /// + `safeFreeText`-hardened here defense-in-depth. ≤20 entries, recency-sorted,
    /// each ≤350 chars (loader-truncated). Empty array when the coach tagged none.
    coachCorrections: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(900)
          .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
          .transform(safeFreeText),
      )
      .max(20),
    /// Notes membre attachées à ses liens TradingView (entrée / sortie) — l'explication
    /// que le membre écrit à côté de son screen. Donnée comportementale auto-déclarée
    /// (l'IA la relie aux corrections du coach pour personnaliser le suivi), JAMAIS
    /// une instruction ni un avis marché. ≤20 items, recency-sorted, chaque `note`
    /// ≤350 chars. Empty array when the member attached no note. REAL side only (§21.5).
    memberScreenNotes: memberScreenNotesSchema,
  })
  .strict();

export type WeeklySnapshot = z.infer<typeof weeklySnapshotSchema>;
