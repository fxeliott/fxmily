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
import type { CoachingReportContext } from '@/lib/coaching/engine';
import type { HabitKind } from '@/lib/schemas/habit-log';
import type { BehavioralScoreTrendPoint } from '@/lib/scoring/service';
import type { SerializedTrade } from '@/lib/trades/service';
// Notes membre TradingView (entrée / sortie) — même shape que le weekly. On
// réutilise le type plutôt que de le dupliquer : ce sont les mêmes colonnes
// (`Trade.tradingViewEntryNote` / `tradingViewExitNote`) lues à la fenêtre du mois.
import type { MemberScreenNote } from '@/lib/weekly-report/types';

export type { MemberScreenNote };

export interface BehavioralScoreSnapshot {
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/**
 * TASK B (SPEC §25.2) — the truncated onboarding-profile reference the loader
 * pre-shapes from `getProfileForUser`. REFERENCE CONTEXT for the prompt TEXT
 * only — NEVER scoring/edge (posture §2). The loader truncates (summary ~600
 * chars, ≤5 axes, ≤5 labels) and DROPS the verbatim `evidence[]` (only the
 * short member-authored `label`s travel). The builder relays it verbatim; the
 * snapshot schema re-hardens (`safeFreeText` + bidi refine) defense-in-depth.
 */
export interface MemberProfileReference {
  summary: string;
  axesPrioritaires: string[];
  highlightLabels: string[];
  /**
   * D1 (SPEC §25.2) — the member's onboarding COACHING REGISTER, relayed from
   * `MemberProfile.coachingTone.register` (Zod-validated at the loader boundary,
   * `null` when absent/malformed). REFERENCE for the prompt TEXT only — it tunes
   * the tone the debrief adopts (`direct` / `pedagogique` / `socratique`), NEVER
   * an input of the behavioural score (firewall §21.5). The verbatim rationale /
   * evidence are deliberately DROPPED — only the enum travels (data minimisation).
   */
  coachingRegister?: 'direct' | 'pedagogique' | 'socratique' | null;
  /**
   * D1 (SPEC §25.2) — the member's onboarding LEARNING STAGE, relayed from
   * `MemberProfile.learningStage.stage` (Zod-validated at the loader boundary,
   * `null` when absent/malformed). REFERENCE for the prompt TEXT only — it lets
   * the debrief nuance the register (`mechanical` / `subjective` / `intuitive`),
   * NEVER an input of the behavioural score (firewall §21.5). The verbatim
   * rationale / evidence are dropped — only the enum travels.
   */
  learningStage?: 'mechanical' | 'subjective' | 'intuitive' | null;
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
  /**
   * Tour 14 — number of OFF days (weekend kept off + explicit declarations) in
   * the civil-month window, PRE-COMPUTED by the loader (same pattern as
   * `meetingScheduledCount`). Count-only, posture §2. Optional: absent → the
   * aggregator defaults it to 0 (existing fixtures stay valid; 0 ⇒ the prompt
   * line simply omits the mention). Feeds the `offDaysCount` counter so the AI
   * reads a jour off as a choice of process, never a missing check-in (§31.2).
   */
  offDaysInWindow?: number;
  /// ≤4 weekly AI summaries of the civil month — INPUT context only (SPEC
  /// §25.3, never an FK). Newest-first; the builder caps + re-hardens.
  weeklySummaries: string[];
  /**
   * TASK B (SPEC §25.2) — the member's OWN onboarding profile (their words),
   * pre-loaded by the loader via `getProfileForUser(userId)` (read-only, in the
   * Promise.all) and pre-truncated at the loader boundary (summary ~600 chars,
   * ≤5 axes, ≤5 highlight labels; the verbatim `evidence[]` is dropped — only
   * the short member-authored labels travel, data minimisation). REFERENCE
   * CONTEXT for the TEXT only: it anchors « progresse-t-il sur SES axes d'entrée »
   * (psycho/process, posture §2) and is NEVER fed to the scoring/edge. 0
   * cross-member leak (THIS member's profile only). `null` when no profile yet
   * (Phase A.2 batch not run / onboarded pre-feature) → the prompt omits the
   * section (no fabricated axes, §33.6).
   */
  memberProfile: MemberProfileReference | null;
  /**
   * J5.4 — continuite N-1 : la sortie IA du debrief du mois PRECEDENT (REEL only
   * §21.5 — `summaryReal` + `recommendations`), pre-chargee par le loader
   * (`db.monthlyDebrief.findFirst` le plus recent < mois courant). Le builder la
   * borne (summary <=600, <=3 reco <=200) + `safeFreeText`. Absente (`?:`) quand le
   * membre n'a aucun debrief anterieur -> le prompt omet le bloc (retrocompat).
   */
  previousDebrief?: {
    /// 1er du mois civil N-1 (`@db.Date` Prisma), rendu tel quel dans le prompt.
    monthStart: Date;
    /// Synthese REELLE du mois N-1 (raw ; le builder tronque + hardening).
    summaryReal: string;
    /// Recommandations donnees le mois N-1 (raw string[] ; builder cap <=3x200).
    recommendations: string[];
  };
  /**
   * J5.1 — reflexions ABCD (CBT Ellis) du membre sur le mois, pre-chargees par
   * le loader (`db.reflectionEntry.findMany` les N plus recentes de la fenetre).
   * Le builder borne (N entrees, chaque champ <= M chars) + `safeFreeText`.
   * Absente (`?:`) quand aucune reflexion -> le builder produit `[]` -> le prompt
   * omet la section (retrocompat).
   */
  reflections?: Array<{
    /// Date civile locale de la reflexion (YYYY-MM-DD), rendue telle quelle.
    date: string;
    /// A — declencheur (evenement factuel).
    triggerEvent: string;
    /// B — croyance automatique.
    beliefAuto: string;
    /// C — consequence (emotion + comportement).
    consequence: string;
    /// D — recadrage / disputation.
    disputation: string;
  }>;
  /**
   * J5.7 — objectifs de PROCESS du membre (anneaux 0-100 + axe de coaching hebdo
   * + objectif de methode derive), pre-charges par le loader via le SSOT
   * `getProcessObjectives` (ce que le membre voit sur /objectifs). Le builder
   * borne + `safeFreeText` (coachingAxis AI-derived). Absente (`?:`) -> le prompt
   * omet la section (retrocompat). §2-safe (process/psycho), hors firewall §21.5.
   */
  objectives?: {
    rings: Array<{ label: string; current: number | null; target: number; reached: boolean }>;
    coachingAxis: string | null;
    methodGoal: { label: string; hint: string; current: number; target: number } | null;
  };
  /**
   * J5.8 — fiches Mark Douglas mises en favori par le membre (titre + categorie),
   * pre-chargees par le loader via le SSOT `listMyFavorites` (published-only,
   * recency-desc). Le builder borne (N + safeFreeText). Absente (`?:`) -> le prompt
   * omet la section (retrocompat). §2-safe (process/psycho), hors firewall §21.5.
   */
  favorites?: Array<{ title: string; category: string }>;
  /**
   * J5.2 — piliers TRACK (HabitLog) DEJA agreges par le loader via le domaine
   * habit (`summarizeHabitPillars`) : moyenne du scalaire + jours loggés par pilier,
   * borne <=5. Le builder pur ne fait qu'un pass-through (firewall §21.5/§25.7 : le
   * report ne couple pas @/lib/analytics ni @/lib/habit depuis le builder). Absente
   * (`?:`) -> le prompt omet la section. §2-safe (hygiene de vie), hors §21.5.
   */
  habits?: Array<{
    kind: HabitKind;
    daysLogged: number;
    average: number;
    unit: 'h' | 'min' | 'repas' | 'cafés';
  }>;
  /**
   * J-AI corrections echo — the coach's corrections on the member's REAL trades
   * over the civil month, pre-formatted by the loader as `« Axe » : commentaire`
   * (only corrections the admin TAGGED with a `TrackingAxis` — the label prefixes
   * the comment so the debrief can theme them). REAL side only: training
   * corrections are §21.5-isolated and never enter this pipeline. Newest-first,
   * loader-capped ≤20 + truncated; the builder relays verbatim (belt-and-suspenders
   * re-harden at the snapshot boundary). Empty array when no tagged correction.
   * The comment is ADMIN free-text → wrapped untrusted at the prompt boundary.
   */
  coachCorrections: string[];
  /**
   * Notes membre attachées à ses liens TradingView (`Trade.tradingViewEntryNote`
   * / `tradingViewExitNote`) sur ses trades RÉELS du mois — l'explication libre
   * que le membre écrit à côté de son screen. Pré-shapé par le loader en
   * `{ pair, direction, kind, note }` (note tronquée ~350 chars, cap ≤20,
   * newest-first). REAL side only : les notes d'entraînement (`TrainingTrade.
   * tradingViewNote`) sont §21.5-isolées et n'entrent jamais ici. Le `note` est du
   * free-text MEMBRE → wrapped untrusted au prompt boundary (le builder re-harden
   * safeFreeText au snapshot boundary). L'IA s'en sert pour relier ce que le membre
   * VOIT à ce que le coach CORRIGE (twin des `coachCorrections`), jamais un avis
   * marché. Requis (défaut `[]` fourni par le loader), comme `coachCorrections`.
   */
  memberScreenNotes: MemberScreenNote[];
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
  // ----- (S5 §32-C/D) COACHING psychologique — moteur d'analyses autonomes -----
  /// Contexte coaching STRUCTURÉ pré-composé par le loader via
  /// `getCoachingReportContext` (DB), period-scopé au mois. Le builder PUR le rend
  /// en bloc Markdown (`renderCoachingContextSection`) dans le snapshot. Optionnel :
  /// `null`/absent quand la carte mentale est vide → le builder n'émet pas le slice
  /// (zéro régression fixtures). §2-safe : copie curée, jamais de marché ni de P&L.
  coaching?: CoachingReportContext | null;
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
  /** First time the member opened this debrief (drives the dashboard nudge). */
  seenAt: string | null;
}
