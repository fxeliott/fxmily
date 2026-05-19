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
  trades: SerializedTrade[];
  checkins: SerializedCheckin[];
  deliveries: SerializedDelivery[];
  annotationsReceived: number;
  annotationsViewed: number;
  latestScore: BehavioralScoreSnapshot | null;
  /// ≤4 weekly AI summaries of the civil month — INPUT context only (SPEC
  /// §25.3, never an FK). Newest-first; the builder caps + re-hardens.
  weeklySummaries: string[];
  // ----- (B) TRAINING section — §21.5 firewall: effort/recency only -----
  training: TrainingEffortInput;
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
