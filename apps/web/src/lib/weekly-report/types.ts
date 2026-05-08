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
  trades: SerializedTrade[];
  checkins: SerializedCheckin[];
  deliveries: SerializedDelivery[];
  annotationsReceived: number;
  annotationsViewed: number;
  latestScore: BehavioralScoreSnapshot | null;
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
