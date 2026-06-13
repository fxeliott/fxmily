/**
 * Types for the V1.4 monthly-debrief PURE aggregator (SPEC §25, J-M1).
 *
 * The aggregator is **pure** (carbon of `weekly-report/builder.ts`): it
 * takes already-serialized DB data loaded by the J-M2 loader and returns a
 * {@link MonthlySnapshot} ready to feed the batch-local Claude Max run as
 * the user-prompt payload. No DB, no `Date.now()`, no I/O — deterministic,
 * Vitest-replayable against a frozen fixture.
 *
 * 🚨 §21.5 (SPEC §25.7, BLOCKING). The training side of the input is the
 * already-derived {@link TrainingEffortInput} — a count + a recency integer
 * + a boolean, sourced by the loader EXCLUSIVELY from the J-T4 sanctioned
 * primitive `countRecentTrainingActivity`. The pure aggregator therefore
 * CANNOT see a backtest P&L: the input type does not carry one. The REAL
 * side legitimately carries real-trade rows (the real section IS real-P&L
 * coaching — that is the product, not a leak; the §25 firewall is training-
 * isolation, never weekly/real isolation — see anti-leak Block G).
 */

import type { SerializedDelivery } from '@/lib/cards/types';
import type { SerializedCheckin } from '@/lib/checkin/service';
import type { BehavioralScoreTrendPoint } from '@/lib/scoring/service';
import type { SerializedTrade } from '@/lib/trades/service';

export interface BehavioralScoreSnapshot {
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/**
 * 🚨 §21.5 — the ONLY shape by which training reaches the monthly snapshot.
 * Effort/recency only; structurally NO `resultR` / `outcome` / `plannedRR`.
 * The loader derives `daysSinceLastBacktest` from the primitive's
 * `lastEnteredAt` with the member tz + window end (it owns the clock; the
 * pure aggregator stays clock-free and just relays).
 */
export interface TrainingEffortInput {
  /// Backtests entered within the civil-month window (volume of practice).
  backtestCount: number;
  /// Whole days since the all-time most recent backtest, or `null` = never.
  daysSinceLastBacktest: number | null;
  /// `true` iff the member has ever logged ≥1 backtest (honest "mois calme"
  /// vs "n'a pas encore commencé", canon §21.4/§23.4).
  hasEverPractised: boolean;
}

/// Builder input — pre-loaded civil-month slices already filtered to the
/// window in the member's local timezone by the J-M2 loader. The real
/// rows mirror `weekly-report/types.ts BuilderInput`; `pseudonymLabel` is
/// pre-computed by the loader at the Claude boundary (SPEC §25.2 — the
/// pure aggregator stays import-free of the pseudonymiser, trivially
/// §21.5-clean and unit-testable).
export interface MonthlyBuilderInput {
  pseudonymLabel: string;
  timezone: string;
  monthStart: Date; // inclusive — local 1st-of-month 00:00
  monthEnd: Date; // inclusive — local last-day 23:59:59.999
  /// Whole days the member's account existed within the window (canon J-T4
  /// account-age guard — "inscrit en cours de mois", SPEC §25.4).
  accountAgeDaysInWindow: number;
  // ----- (A) REAL section — legitimate real-trade P&L coaching ----------
  /// D3-01 — extends `SerializedTrade` with the post-outcome behavioural
  /// `tags` (CFA LESSOR + Steenbarger biases: revenge-trade, loss-aversion,
  /// overconfidence…). The field is collected in DB but `SerializedTrade`
  /// (the shared UI-facing view) does not surface it, so the loader serializes
  /// it inline here. Required `string[]` (the Prisma column is
  /// `String[] @default([])`, never null). Psycho self-declaration only —
  /// NEVER market advice (posture §2).
  trades: Array<SerializedTrade & { tags: string[] }>;
  checkins: SerializedCheckin[];
  deliveries: SerializedDelivery[];
  annotationsReceived: number;
  annotationsViewed: number;
  latestScore: BehavioralScoreSnapshot | null;
  /**
   * DoD#3 / §29 "progression MESURABLE" — la série ASCENDANTE des scores
   * comportementaux journaliers du membre sur ~75 jours (≈2 mois + marge),
   * sourcée par le loader via `getBehavioralScoreHistory(userId, { sinceDays: 75 })`.
   * Le builder en dérive `scoreProgression` : un point de BASELINE (score
   * d'entrée de mois, le plus récent ≤ `monthStartLocal`) et le DELTA vers le
   * point courant (le plus récent de la série). Chaque dimension reste
   * `number | null` (`insufficient_data` un jour donné n'est JAMAIS un faux 0).
   * Posture §2 : ce sont des scores PSYCHOLOGIQUES internes, jamais du marché.
   */
  scoreHistory: BehavioralScoreTrendPoint[];
  /// `YYYY-MM-DD` (1er du mois civil local) — l'ancre qui sépare la baseline
  /// N-1 (≤ cette date) du courant. Fourni par le loader (`window.monthStartLocal`).
  monthStartLocal: string;
  /**
   * SPEC §28/§30 — meeting (réunion Fxmily) attendance over the civil-month
   * window. Two integer COUNTS sourced by the loader from the count-only
   * primitive `countMeetingAttendance` ({ scheduledCount, completedCount }) —
   * no meeting body, no P&L. The aggregator turns them into the explicit
   * `meetingAttendance` REAL counter (count-only assiduité signal, posture §2).
   * Optional: absent → the aggregator defaults both to 0 (existing fixtures
   * stay valid; a 0/0 window yields a `null` rate, never a fake "0 %").
   * Meeting assiduité is NOT §21.5-isolated (§30.7) — this is a real-edge-side
   * engagement counter, mirror of the weekly `meetingAttendance`.
   */
  meetingScheduledCount?: number;
  meetingCompletedCount?: number;
  /// ≤4 weekly AI summaries of the civil month — INPUT context only (SPEC
  /// §25.3, never an FK). Newest-first; the builder caps + re-hardens.
  weeklySummaries: string[];
  // ----- (B) TRAINING section — §21.5 firewall: effort/recency only -----
  training: TrainingEffortInput;
  // ----- (C) VERIFICATION & CONSTANCY — Session 3 (DOD3-01 / DoD#2 S6) -----
  /// Count-only S3 counters PRE-COMPOSED by the loader. `constancy` + `alertCount`
  /// are PERIOD-SCOPED to the reported month (the ConstancyScore OF that month +
  /// the alerts triggered in it — NEVER `getLatestConstancyScore`, which is the
  /// current week); `openDiscrepancyCount` is a CURRENT-STATE count (écarts still
  /// open now), point-in-time by design. `constancy` is the DEDICATED S3 score
  /// (honesty/regularity/discipline), not the `consistency` sub-score of
  /// BehavioralScore (S2/S5). `null` when the member has no constancy signal for
  /// the period (no fake neutral score, §33.6). Posture §2/§33.2 — factual numbers
  /// only, never market advice.
  verification: {
    constancy: {
      value: number;
      honesty: number | null;
      regularity: number | null;
      discipline: number | null;
    } | null;
    /// §29 "voir son évolution" — the DEDICATED ConstancyScore of the PREVIOUS
    /// civil month (latest in-range), so the monthly debrief can anchor the
    /// honesty/regularity trajectory on a real month-over-month delta (mirror of
    /// the behavioural `scoreProgression`). `null` when no prior-month signal —
    /// the prompt then omits the progression line (no fabricated trend, §33.6).
    constancyPrevious: {
      value: number;
      honesty: number | null;
      regularity: number | null;
      discipline: number | null;
    } | null;
    openDiscrepancyCount: number;
    alertCount: number;
  };
}

export type { MonthlySnapshot, MonthlyDebriefOutput } from '@/lib/schemas/monthly-debrief';

/**
 * JSON-safe view of a `MonthlyDebrief` row — output of the J-M4 service
 * layer, consumed by the member page, the admin read-only panel and the
 * email template. Decimals → strings, Dates → ISO/YYYY-MM-DD.
 *
 * Defined here (not in service.ts) so the email module can `import type`
 * it without a runtime cycle (mirror `weekly-report/types.ts`).
 */
export interface SerializedMonthlyDebrief {
  id: string;
  userId: string;
  /** YYYY-MM-DD (local 1st-of-month). */
  monthStart: string;
  /** YYYY-MM-DD (local last calendar day of the month). */
  monthEnd: string;
  generatedAt: string;
  progressionNarrative: string;
  summaryReal: string;
  summaryTraining: string;
  risks: string[];
  recommendations: string[];
  /// Re-uses the inferred shape so optional pattern fields stay
  /// `?: string | undefined` (keeps `exactOptionalPropertyTypes` happy).
  patterns: import('@/lib/schemas/monthly-debrief').MonthlyDebriefOutput['patterns'];
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** EUR with 6-decimal precision. */
  costEur: string;
  sentToMemberAt: string | null;
  sentToMemberEmail: string | null;
  pushEnqueuedAt: string | null;
}
