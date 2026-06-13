/**
 * Types for the J8 weekly-report builder (Phase A — foundation).
 *
 * The builder is **pure** : it takes already-serialized DB data (loaded by
 * the service layer in Phase B) and returns a {@link WeeklySnapshot} ready
 * to be sent to Claude Sonnet 4.6 as the user-prompt payload.
 *
 * Why pure : same posture as `lib/scoring/*` and `lib/analytics/*`. Easy to
 * unit-test, no DB dependency, deterministic, can be replayed against a
 * frozen fixture in Vitest.
 */

import type { SerializedDelivery } from '@/lib/cards/types';
import type { SerializedCheckin } from '@/lib/checkin/service';
import type { SerializedTrade } from '@/lib/trades/service';

/// Behavioral score snapshot mirror — pure type, decoupled from Prisma.
/// Service layer (Phase B) will translate `BehavioralScore` Prisma rows into
/// this shape before passing them to the builder. Null fields = `insufficient_data`.
export interface BehavioralScoreSnapshot {
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/// Builder input — pre-loaded slices already filtered to the 7-day window
/// in the **member's local timezone** by the service layer (Phase B).
export interface BuilderInput {
  userId: string;
  timezone: string;
  weekStart: Date; // inclusive — local-Monday at 00:00
  weekEnd: Date; // inclusive — local-Sunday at 23:59:59
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
  /**
   * SPEC §21 J-T4 — number of the member's backtests in the report week
   * ("volume de pratique"). Optional: absent → the builder defaults it to 0
   * (existing fixtures + pre-J-T4 callers stay valid). 🚨 §21.5: an integer
   * COUNT only — `resultR`/`outcome`/`plannedRR` MUST NEVER reach the
   * weekly snapshot / Claude prompt. Recency lives in the inactivity
   * trigger, not here (SPEC line is "volume pratique").
   */
  trainingActivityCount?: number;
  /**
   * SPEC §28/§30 — meeting (réunion Fxmily) attendance over the report window.
   * Two integer COUNTS sourced by the loader from the count-only primitive
   * `countMeetingAttendance` ({ scheduledCount, completedCount }) — no meeting
   * body, no P&L. The builder turns them into the explicit
   * `meetingAttendance` counter (count-only behavioural assiduité signal,
   * posture §2). Optional: absent → the builder defaults both to 0 (existing
   * fixtures + pre-§28 callers stay valid; a 0/0 window yields a `null` rate,
   * never a fake "0 %").
   */
  meetingScheduledCount?: number;
  meetingCompletedCount?: number;
  latestScore: BehavioralScoreSnapshot | null;
  /// DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters PRE-COMPOSED by
  /// the loader. `constancy` + `alertCount` are PERIOD-SCOPED to the reported week
  /// (the ConstancyScore OF that week + alerts triggered in it — NEVER
  /// `getLatestConstancyScore`, which is the current ISO week); `openDiscrepancyCount`
  /// is a CURRENT-STATE count (écarts still open now), point-in-time by design.
  /// `constancy` is the DEDICATED S3 score (honesty/regularity/discipline), not the
  /// `consistency` sub-score of BehavioralScore (S2/S5). `null` when no constancy
  /// signal for the week (no fake neutral score, §33.6). Posture §2/§33.2 — facts only.
  verification: {
    constancy: {
      value: number;
      honesty: number | null;
      regularity: number | null;
      discipline: number | null;
    } | null;
    openDiscrepancyCount: number;
    alertCount: number;
  };
}

export type { WeeklySnapshot, WeeklyReportOutput } from '@/lib/schemas/weekly-report';

/**
 * JSON-safe view of a `WeeklyReport` row — output of the Phase B service
 * layer (`lib/weekly-report/service.ts`) and the shape consumed by both the
 * admin UI and the email template. Decimals → strings, Dates → ISO/YYYY-MM-DD.
 *
 * Defined here (not in service.ts) so the email module can `import type` it
 * without a runtime cycle through `service.ts → send.ts → service.ts`.
 */
export interface SerializedWeeklyReport {
  id: string;
  userId: string;
  /** YYYY-MM-DD (local Monday). */
  weekStart: string;
  /** YYYY-MM-DD (local Sunday). */
  weekEnd: string;
  generatedAt: string;
  summary: string;
  risks: string[];
  recommendations: string[];
  /// Re-uses the Phase A inferred shape so optional fields stay `?: string | undefined`,
  /// keeping `exactOptionalPropertyTypes` happy (the parser can return objects without
  /// the field at all OR with the field present as a string — never as `undefined`).
  patterns: import('@/lib/schemas/weekly-report').WeeklyReportOutput['patterns'];
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** EUR with 6-decimal precision. */
  costEur: string;
  sentToAdminAt: string | null;
  sentToAdminEmail: string | null;
  emailMessageId: string | null;
}
