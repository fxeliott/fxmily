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
import type { CoachingReportContext } from '@/lib/coaching/engine';
import type { MomentumHistoryPoint } from '@/lib/scoring/momentum';
import type { SerializedTrade } from '@/lib/trades/service';

/**
 * Notes membre attachées à ses liens TradingView (`Trade.tradingViewEntryNote` /
 * `tradingViewExitNote`) — l'explication que le membre écrit À CÔTÉ de son screen
 * d'entrée / de sortie ("ce que je vois / ce que je fais"). REFERENCE CONTEXT pour
 * le prompt TEXT uniquement (l'IA relie ces lectures aux corrections du coach pour
 * personnaliser le suivi), NEVER scoring/edge — posture §2. `pair`/`direction`
 * situent la note ; `kind` distingue l'entrée de la sortie. Le loader tronque
 * chaque `note` (~350 chars) et cap ≤20 (newest-first) ; le builder re-harden
 * (`safeFreeText` + le schéma refine bidi) defense-in-depth. Le comment est du
 * free-text MEMBRE → wrapped untrusted au prompt.
 * 🚨 §21.5 — REAL side ONLY : les notes d'entraînement (`TrainingTrade.
 * tradingViewNote`) sont isolées et n'entrent JAMAIS dans ce pipeline.
 */
export interface MemberScreenNote {
  pair: string;
  direction: 'long' | 'short';
  kind: 'entree' | 'sortie';
  note: string;
}

/**
 * V1.8 REFLECT — the member's OWN weekly review (the Sunday recap wizard they
 * fill themselves : 5 free-text answers about their week). REFERENCE CONTEXT
 * for the prompt TEXT only (the AI compares the member's self-assessment to
 * the observed data), NEVER scoring/edge — posture §2. The loader truncates
 * each answer (~300 chars, trim + slice) ; the builder re-hardens
 * (`safeFreeText` + the schema's bidi refine) defense-in-depth. MEMBER
 * free-text → wrapped untrusted at the prompt boundary. `bestPractice` is the
 * wizard's only optional answer → honest `null` when left empty.
 * 🚨 §21.5 — REAL side ONLY : the review is the member's reflection on their
 * REAL week (REFLECT surface), not training data.
 */
export interface MemberWeeklyReviewAnswers {
  biggestWin: string;
  biggestMistake: string;
  bestPractice: string | null;
  lessonLearned: string;
  nextWeekFocus: string;
}

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
   * Quick win — the coach's TAGGED corrections on this member's REAL trades over
   * the report week, pre-formatted by the loader as `« Axe » : commentaire` (only
   * corrections the admin tagged with a `TrackingAxis` — the label prefixes the
   * comment so the report can theme them). REAL side only: training corrections
   * are §21.5-isolated and never enter this pipeline. Newest-first, loader-capped
   * ≤20 + truncated; the builder relays verbatim (belt-and-suspenders re-harden at
   * the snapshot boundary). Optional: absent → the builder defaults to `[]`
   * (existing fixtures + pre-quick-win callers stay valid). The comment is ADMIN
   * free-text → wrapped untrusted at the prompt boundary. Twin of the monthly
   * debrief's `coachCorrections` (this is THE report the coach reads, so his own
   * corrections belong in it).
   */
  coachCorrections?: string[];
  /**
   * Notes membre attachées à ses liens TradingView (`Trade.tradingViewEntryNote`
   * / `tradingViewExitNote`) sur ses trades RÉELS de la semaine — l'explication
   * libre que le membre écrit à côté de son screen. Pré-shapé par le loader en
   * `{ pair, direction, kind, note }` (note tronquée ~350 chars, cap ≤20,
   * newest-first). REAL side only : les notes d'entraînement (`TrainingTrade.
   * tradingViewNote`) sont §21.5-isolées et n'entrent jamais ici. Optional :
   * absent → le builder défaut à `[]` (fixtures + pré-feature callers restent
   * valides). Le `note` est du free-text MEMBRE → wrapped untrusted au prompt
   * (le builder re-harden safeFreeText au snapshot boundary). L'IA s'en sert pour
   * relier ce que le membre VOIT à ce que le coach CORRIGE (twin des
   * `coachCorrections`), jamais un avis marché.
   */
  memberScreenNotes?: MemberScreenNote[];
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
  /**
   * S15 #6/#7 — daily behavioral-score history (≤ 90 d, ascending) for the
   * snapshot's momentum signal (sustained multi-week declines). Optional →
   * defaults to `[]` in the builder (zero-regression for existing fixtures /
   * pre-S15 callers). COUNT-ONLY posture: scores 0–100, never P&L.
   */
  scoreHistory?: MomentumHistoryPoint[];
  /**
   * Tour 14 — number of OFF days (weekend kept off + explicit declarations) in
   * the report window, PRE-COMPUTED by the loader (same pattern as
   * `meetingScheduledCount` / `trainingActivityCount`). Count-only, posture §2.
   * Optional: absent → the builder defaults it to 0 (existing fixtures +
   * pre-Tour-14 callers stay valid; a 0 yields "0 jours off" ⇒ the prompt line
   * simply omits it). Feeds the `offDaysCount` counter so the AI reads a jour off
   * as a choice of process, never a missing check-in (§31.2).
   */
  offDaysInWindow?: number;
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
  /// S5 §32-C/D — contexte coaching psychologique STRUCTURÉ, pré-composé par le
  /// loader via `getCoachingReportContext` (DB), period-scopé à la semaine. Le
  /// builder PUR le rend en bloc Markdown (`renderCoachingContextSection`) dans
  /// le snapshot. Optionnel : `null`/absent quand le membre n'a aucun insight à
  /// synthétiser (carte mentale vide) → le builder n'émet pas le slice (zéro
  /// régression pour les fixtures existantes). §2-safe : copie curée, jamais de
  /// marché ni de P&L (invariant porté par le moteur).
  coaching?: CoachingReportContext | null;
  /**
   * V1.8 REFLECT — the member's own weekly review for the report week (keyed
   * `(userId, weekStart)` on the civil local Monday). Pre-truncated by the
   * loader (~300 chars/answer, trim + slice) ; the builder re-hardens
   * (`safeFreeText`) and the prompt wraps it untrusted. Optional : absent or
   * `null` when the member submitted no review → the builder omits the slice
   * (honest empty state, existing fixtures stay valid).
   * 🚨 §21.5 — REAL side ONLY (member reflection on their REAL week).
   */
  memberWeeklyReview?: MemberWeeklyReviewAnswers | null;
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
