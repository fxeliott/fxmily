/**
 * J-E — Shared types for the ADMIN-ONLY monthly deep re-profiling pipeline.
 *
 * Each civil month, the 4 onboarding deep dimensions (coaching tone, learning
 * stage, structured axes, weak signals) are RE-derived from the member's OWN
 * introspective words of that month, alongside an `evolutionNarrative` that
 * compares the fresh reading against the onboarding baseline + the previous
 * month's snapshot. The result is persisted to `MemberProfileMonthlySnapshot`
 * (ADD-only, never overwriting the onboarding `MemberProfile` baseline) and
 * surfaced to the admin ONLY.
 *
 * 🚨 Invariants (firewall §21.5 / §27.7, BLOCKING):
 *   - NONE of the 4 re-profiled dimensions is EVER a scoring/edge input. This
 *     module produces admin reference text only.
 *   - `weakSignals` is ADMIN-ONLY — it never crosses onto a member coaching
 *     surface (it may still travel through the RGPD Art. 15 export channel,
 *     which is the member's own data, not a coaching surface).
 *   - Every re-profiled `evidence[i]` MUST be a verbatim NFC substring of the
 *     month's reflection corpus (see {@link concatReflectionCorpus} in
 *     `safety.ts`). The onboarding baseline + previous-month snapshot are
 *     REFERENCE context for the narrative only — never a citable evidence
 *     source (the narrative carries no evidence[]).
 *   - Pseudonymised at the Claude boundary; no raw email/name/userId reaches
 *     the model.
 */

export type CoachingRegister = 'direct' | 'pedagogique' | 'socratique';
export type LearningStageValue = 'mechanical' | 'subjective' | 'intuitive';

/**
 * One piece of the member's OWN introspective words this month — the source
 * corpus every re-profiled dimension's `evidence[]` must verbatim-cite. Free
 * text only (intention / journal / gratitude / trade note); structured enum
 * tags are aggregated into {@link MonthlyReprofileProcessSignals}, never here
 * (an enum like `revenge_trade` is not a natural citation).
 */
export interface MonthlyReflectionEntry {
  /**
   * Provenance label for prompt grouping + audit — one of `intention`,
   * `journal`, `gratitude`, `trade_note`.
   */
  readonly source: 'intention' | 'journal' | 'gratitude' | 'trade_note';
  /// Member-local calendar day (`YYYY-MM-DD`) the reflection was authored.
  readonly localDate: string;
  /// The member's verbatim words (already `safeFreeText`-sanitised so the
  /// rendered prompt, the corpus and the evidence gate all agree byte-for-byte).
  readonly text: string;
}

/**
 * The prior baseline the evolution narrative compares AGAINST. REFERENCE
 * context only — never a citable evidence source, never a scoring input.
 */
export interface MonthlyReprofileBaseline {
  /// Onboarding coaching register (enum only; rationale/evidence dropped).
  readonly coachingRegister: CoachingRegister | null;
  /// Onboarding learning stage (enum only).
  readonly learningStage: LearningStageValue | null;
  /// Onboarding summary (truncated) — the member's entry-point portrait.
  readonly onboardingSummary: string | null;
  /// The immediately-previous monthly snapshot (month-over-month trajectory).
  readonly previousMonth: {
    readonly monthStartLocal: string;
    readonly evolutionNarrative: string;
    readonly coachingRegister: CoachingRegister | null;
    readonly learningStage: LearningStageValue | null;
  } | null;
  /**
   * J-AI corrections echo — the coach's TAGGED corrections on the member's REAL
   * trades this month, pre-formatted `« Axe » : commentaire`. REFERENCE context
   * for the narrative ONLY (never a citable evidence source, exactly like the
   * onboarding baseline / previous-month narrative): an admin correction is NOT a
   * member reflection, so it stays out of {@link concatReflectionCorpus} and can
   * never back an `evidence[i]`. REAL side only — training corrections are §21.5-
   * isolated and never enter this pipeline. Empty array when no tagged correction.
   */
  readonly coachCorrections: readonly string[];
}

/**
 * Count-only structured signals for grounding the narrative (never a scoring
 * input, posture §2). `tagFrequencies` aggregates the month's emotion /
 * behavioural enum tags — context the model reasons about, NOT citable
 * evidence (kept out of the reflection corpus on purpose).
 */
export interface MonthlyReprofileProcessSignals {
  readonly reflectionCount: number;
  readonly tradeCount: number;
  readonly checkinCount: number;
  readonly tagFrequencies: readonly { readonly tag: string; readonly count: number }[];
}

/**
 * The pseudonymised monthly slice handed to Claude (as the user prompt) AND
 * re-derived server-side at persist for the evidence gate. Deterministic for a
 * fixed `(now, timezone)` so two runs in the same month produce the same slice
 * (idempotency `(userId, monthStart)`).
 */
export interface MonthlyReprofileSnapshot {
  readonly pseudonymLabel: string;
  readonly timezone: string;
  /// `YYYY-MM-01` (member-local 1st of the reported civil month).
  readonly monthStartLocal: string;
  /// `YYYY-MM-DD` (member-local last calendar day of the month).
  readonly monthEndLocal: string;
  /// Whole days the member's account existed within the window (§25.4 guard).
  readonly accountAgeDaysInWindow: number;
  /// The month's introspective free-text corpus (source of all evidence[]).
  readonly reflections: readonly MonthlyReflectionEntry[];
  readonly baseline: MonthlyReprofileBaseline;
  readonly processSignals: MonthlyReprofileProcessSignals;
}

/**
 * Raw serialized rows the IO loader (`loader.ts`) hands to the PURE builder
 * ({@link buildReprofileSnapshot} in `snapshot.ts`). Splitting IO from the
 * transformation keeps the interesting logic clock/DB-free and fixture-
 * replayable (mirror `weekly-report`/`monthly-debrief` loader/builder split).
 */
export interface RawReprofileSlice {
  readonly pseudonymLabel: string;
  readonly timezone: string;
  readonly monthStartLocal: string;
  readonly monthEndLocal: string;
  readonly accountAgeDaysInWindow: number;
  readonly checkins: readonly RawReprofileCheckin[];
  readonly trades: readonly RawReprofileTrade[];
  readonly baselineProfile: {
    readonly onboardingSummary: string | null;
    readonly coachingRegister: CoachingRegister | null;
    readonly learningStage: LearningStageValue | null;
  } | null;
  readonly previousMonthSnapshot: {
    readonly monthStartLocal: string;
    readonly evolutionNarrative: string;
    readonly coachingRegister: CoachingRegister | null;
    readonly learningStage: LearningStageValue | null;
  } | null;
  /**
   * J-AI corrections echo — the coach's TAGGED corrections on the member's REAL
   * trades this month, pre-formatted `« Axe » : commentaire` by the loader.
   * REFERENCE context only (never citable). Optional: the persist-time corpus
   * re-derivation ({@link loadReflectionCorpusForMonth}) omits it because the
   * corpus depends only on the member's reflections, never on the baseline /
   * corrections reference. Absent/empty → the prompt omits the corrections block.
   */
  readonly coachCorrections?: readonly string[];
}

/**
 * J-E inc.3 — JSON-safe view of a `MemberProfileMonthlySnapshot` row for the
 * ADMIN trajectory tab (`/admin/members/[id]?tab=trajectoire`). Dates → strings,
 * the 4 deep dims stay raw `unknown` (Prisma `Json?`) and are Zod-`safeParse`d
 * at RENDER by the shared `deep-dimension-sections` renderer (mirror the
 * onboarding `SerializedMemberProfile` contract — parse defensively at the UI
 * boundary, never trust the JSON column shape).
 *
 * Defined HERE (not in the `server-only` admin service) so the presentational
 * panel can `import type` it without pulling a server-only runtime edge — same
 * split as `monthly-debrief/types.ts SerializedMonthlyDebrief`.
 *
 * 🚨 ADMIN-ONLY: `weakSignals` rides along because this is an admin reading
 * surface (never a member coaching surface); it is NEVER a scoring input.
 */
export interface SerializedMonthlyProfileSnapshot {
  readonly id: string;
  readonly userId: string;
  /** `YYYY-MM-DD` (member-local 1st of the reported civil month). */
  readonly monthStart: string;
  /** `YYYY-MM-DD` (member-local last calendar day of the month). */
  readonly monthEnd: string;
  /** ISO instant the snapshot was generated. */
  readonly generatedAt: string;
  /** ADMIN-ONLY month-over-month evolution synthesis (the J-E value-add). */
  readonly evolutionNarrative: string;
  readonly coachingTone: unknown;
  readonly learningStage: unknown;
  readonly axesStructured: unknown;
  readonly weakSignals: unknown;
  /** Claude model pin (drives the AI Act art.50 banner label). */
  readonly claudeModel: string;
}

export interface RawReprofileCheckin {
  readonly localDate: string;
  readonly intention: string | null;
  readonly journalNote: string | null;
  readonly gratitudeItems: readonly string[];
  readonly emotionTags: readonly string[];
}

export interface RawReprofileTrade {
  readonly localDate: string;
  readonly notes: string | null;
  readonly emotionBefore: readonly string[];
  readonly emotionDuring: readonly string[];
  readonly emotionAfter: readonly string[];
  readonly tags: readonly string[];
}
