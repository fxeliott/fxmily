/**
 * Pure aggregator that turns a 7-day slice of DB data into a
 * {@link WeeklySnapshot} ready to feed into Claude Sonnet 4.6 as the user
 * prompt payload (J8 — Phase A foundation, V1.5 pseudonymization,
 * V1.5.2 32-bit hardening).
 *
 * Posture (SPEC §2 + §20.4 + V1.5 pseudonymization) :
 *   - **Zero PII in the snapshot.** No email, no name, no raw cuid.
 *     `pseudonymLabel` (e.g. `member-A1B2C3D4`) replaces `userId` at the
 *     prompt boundary — see `pseudonymizeMember` below. **V1.5.2 rename**
 *     from `memberLabel` to disambiguate from the J8 display name
 *     `WeeklyDigestEmail.memberLabel` (= "Sophie Martin"), which lives at a
 *     different layer and never crosses the prompt boundary.
 *   - **`safeFreeText` on every member-controlled string** before it enters
 *     the snapshot. Prompt-injection defense (Trojan Source bidi reorder +
 *     zero-width invisible instructions). Applied here so downstream layers
 *     never have to remember (defense-in-depth).
 *   - **No analyse de marché.** Counters + emotion×outcome patterns only.
 *
 * Pure — no DB calls, no `Date.now()`, no I/O. Service layer (Phase B) loads
 * the slice and calls this. Easy to unit-test against a frozen fixture.
 */

import { createHash } from 'node:crypto';

import type { TradeSession } from '@/generated/prisma/client.js';

import { computeMaxConsecutiveLoss } from '@/lib/analytics/streaks';
import { renderCoachingContextSection } from '@/lib/coaching/engine';
import { detectMomentum } from '@/lib/scoring/momentum';
import {
  EMOTION_ARC_MIN_TO_SURFACE,
  emotionArcDegradation,
  HOURLY_MIN_SAMPLE,
  perEmotionField,
  perHour,
} from '@/lib/scoring/pattern-rhythms';
import type { SerializedTrade } from '@/lib/trades/service';
import { safeFreeText } from '@/lib/text/safe';
import { EXIT_REASON_LABELS } from '@/lib/trading/exit-reasons';

import type { BuilderInput, WeeklySnapshot } from './types';

const JOURNAL_EXCERPT_MAX_CHARS = 200;
const JOURNAL_EXCERPTS_MAX = 5;
// TASK A — recent member MORNING intention verbatim (twin of journalExcerpts,
// the SOIR/journalNote path): same recency sort, same safeFreeText + truncate
// ~200 chars, same cap. Reads `intention` (written the MATIN) on the `morning`
// slot — Mark Douglas material (intention vs execution, process vs outcome).
const MORNING_INTENTION_MAX_CHARS = 200;
const MORNING_INTENTIONS_MAX = 5;
const EMOTION_TAGS_MAX = 20;
// D3-01 — cap on the distinct behavioural bias tags (LESSOR/Steenbarger)
// surfaced to Claude. Lower than EMOTION_TAGS_MAX (20) : the bias allowlist is
// short (UI caps 3/trade) so 12 distinct tags is ample headroom for a week.
const BEHAVIOR_TAGS_MAX = 12;
const PAIRS_MAX = 10;
const SESSIONS_ALL: readonly TradeSession[] = ['asia', 'london', 'newyork', 'overlap'];
// Quick win — cap + per-item truncation for the coach-corrections corpus, twin
// of the monthly loader's `WEEKLY_CONTEXT_ITEM_MAX_CHARS` re-harden. The loader
// already caps/truncates; the builder re-hardens defense-in-depth (belt-and-
// suspenders, mirror the monthly `buildCoachCorrections`).
const COACH_CORRECTIONS_MAX = 20;
const COACH_CORRECTION_ITEM_MAX_CHARS = 900;
// Notes membre TradingView — cap + per-note re-harden truncation, twin of the
// coach-corrections re-harden. The loader already caps/truncates (~350); the
// builder re-hardens defense-in-depth (belt-and-suspenders, mirror the
// coach-corrections path). 900 is the schema's per-string ceiling.
const MEMBER_SCREEN_NOTES_MAX = 20;
const MEMBER_SCREEN_NOTE_ITEM_MAX_CHARS = 900;
// V1.8 REFLECT — per-answer re-harden truncation for the member's own weekly
// review, twin of the coach-corrections / screen-notes re-hardens. The loader
// already truncated (~300); the builder re-hardens defense-in-depth. 400 is
// the schema's per-string ceiling (PATTERN_VALUE_MAX_CHARS).
const MEMBER_WEEKLY_REVIEW_FIELD_MAX_CHARS = 400;

// =============================================================================
// Pseudonymization (V1.5 — prompt boundary defense)
// =============================================================================

/**
 * Map a member's `userId` (cuid) to a stable label of the form
 * `member-XXXXXXXX` (8 hex chars = 32 bits, V1.5.2 widening from the
 * V1.5 24-bit space).
 *
 * Properties (with optional salt):
 *   - **Deterministic** : same `(userId, salt)` → same label across runs.
 *   - **Pseudonymous, not anonymous** (GDPR Art. 4(5)) : reversible by anyone
 *     who has the salt + the userId — i.e. by Fxmily itself. The label is a
 *     prompt-boundary defence against accidental Anthropic-side leaks, not
 *     an anonymisation primitive.
 *   - **Without a salt** (default V1) : an attacker who knows a candidate
 *     cuid can verify its presence in a leaked report by hashing once
 *     (~1 ms). For V1 30-100 closed cohort with no external rapport export
 *     this is acceptable risk. **For V2 with cohort > 100 OR external
 *     report export (audit Anthropic, Slack archive, S3 backup of digests)
 *     set `MEMBER_LABEL_SALT` env var** (server-side secret) to make
 *     ré-identification require the salt.
 *   - **NFC normalization** (V1.5.2) : `userId.normalize('NFC')` defends
 *     against the theoretical NFC-vs-NFD divergence where two visually
 *     identical identifiers hash differently. Cuid is alphanum-only so this
 *     is defensive-only for V1 (no observed collision), but the function is
 *     exported and a V2 caller could feed arbitrary identifiers.
 *
 * Birthday-paradox correctness (32-bit hex space, n = 4,294,967,296):
 *   - 50 % collision threshold ≈ √(π·n / 2) ≈ **77,163 members**
 *     (V1.5 24-bit threshold was 4,823 — V1.5.2 widened to 77 k for V2 scale).
 *   - At n = 1000: P(≥1 collision) ≈ 1 − exp(−1000² / (2·n)) ≈ **0.012 %**
 *     (V1.5 was 2.9 % at n=1000 — orders of magnitude safer now).
 *   - Sufficient through Fxmily V2 launch even at 100k+ members.
 *
 * **Migration data note (V1.5.2 widening)** :
 *   - Historical `WeeklyReport` rows generated under V1.5 carry **6-char
 *     pseudonymLabels** (extracted from the persisted `summary` text the LLM
 *     copied them into, OR derivable by re-hashing `userId` post-fact).
 *   - V1.5.2+ rows carry **8-char pseudonymLabels**.
 *   - The two formats coexist by design (pure schema-level concern, no DB
 *     column to migrate — `WeeklyReport.userId` is the FK, not the label).
 *   - When Eliott opens an admin report from before the V1.5.2 cutoff, the
 *     UI / email shows the 6-char label as it was generated. New runs of
 *     `generateWeeklyReportForUser` always produce 8-char labels.
 *   - **No replay required** : the label is a prompt-boundary artefact, not
 *     a join key. The Birthday-paradox 24-bit risk for the 30-member V1
 *     cohort was ~0.0001 % so historical rows have effectively zero
 *     collision in their existing 6-char form.
 *
 * Pure mathematically (no Date.now, no random); reads `process.env` at call
 * time so the salt rotates at next process restart (intentional — see
 * `lib/env.ts MEMBER_LABEL_SALT` doc).
 */
export function pseudonymizeMember(userId: string, salt?: string): string {
  // Defensive guard (security-auditor #7) : an empty userId is a programming
  // error — silently labelizing it would collapse all malformed inputs onto
  // the constant SHA-256(empty) hash and poison the cohort distribution.
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TypeError('pseudonymizeMember requires a non-empty userId');
  }
  // V1.5.2 — NFC normalization. Cuid is alphanum-only (NFC == NFD by
  // construction) so this is a no-op in V1, but the function is exported and
  // a V2 caller could feed arbitrary identifiers (Apple Health UID, ULID,
  // etc.). Normalizing here keeps the contract robust to encoding mishap.
  const normalizedUserId = userId.normalize('NFC');
  // Default to env var; tests pass `salt: ''` explicitly to assert the
  // unsalted behavior is reproducible.
  const effectiveSalt = salt ?? process.env.MEMBER_LABEL_SALT ?? '';
  const input = effectiveSalt === '' ? normalizedUserId : `${effectiveSalt}:${normalizedUserId}`;
  // V1.5.2 — 32-bit slice (8 hex chars) widens the namespace 256× vs V1.5
  // 24-bit (6 chars). Birthday 50 % threshold ~77 k members, sufficient for
  // V2 scale before the next migration would be needed.
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 8).toUpperCase();
  return `member-${hash}`;
}

// =============================================================================
// Public entrypoint
// =============================================================================

export function buildWeeklySnapshot(input: BuilderInput): WeeklySnapshot {
  // S15 #7 — behaviour→outcome cross-cuts (sample-gated). Omitted entirely when
  // nothing clears its honest threshold (exactOptionalPropertyTypes → spread).
  const patternSignals = buildPatternSignals(input);
  return {
    pseudonymLabel: pseudonymizeMember(input.userId),
    timezone: input.timezone,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    counters: buildCounters(input),
    freeText: buildFreeText(input),
    scores: buildScores(input),
    // DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters, relayed verbatim
    // (the loader did the period-scoped read; the pure aggregator stays clock-free).
    // COUNT-ONLY posture §2 — factual numbers, never a market view.
    verification: input.verification,
    ...(patternSignals ? { patternSignals } : {}),
    // S5 §32-C/D — synthèse de coaching psychologique. Le loader fournit le
    // contexte STRUCTURÉ (DB) ; ici (pur) on le rend en bloc Markdown via le
    // moteur (SSOT du format). Absent → slice omis (exactOptionalPropertyTypes).
    // §2-safe : la copie est curée par le moteur (jamais un terme de marché).
    ...(input.coaching ? { coaching: renderCoachingContextSection(input.coaching) } : {}),
    // Quick win — the coach's TAGGED corrections on this member's REAL trades this
    // week, relayed verbatim from the loader (`« Axe » : commentaire`), capped ≤20 +
    // re-hardened defense-in-depth. ADMIN free-text → wrapped untrusted at the prompt
    // boundary; this is THE report the coach reads, so his corrections belong in it
    // (parity with the monthly debrief). Empty array when the coach tagged none.
    coachCorrections: buildCoachCorrections(input),
    // Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    // trades RÉELS de la semaine — l'explication que le membre écrit à côté de son
    // screen. MEMBER free-text → wrapped untrusted au prompt boundary + re-hardened
    // (`safeFreeText`) defense-in-depth. L'IA la relie aux corrections du coach pour
    // personnaliser le suivi. Empty array when the member attached no note. REAL side
    // only (§21.5 keeps training notes out entirely).
    memberScreenNotes: buildMemberScreenNotes(input),
    // Quick win — factual exit-reason distribution over the week's CLOSED trades
    // (count per `Trade.exitReason`, FR label). Absent → slice omitted (no closed
    // trade carried an exitReason, feature récente). Posture §2 (factual, never a
    // market view). exactOptionalPropertyTypes → conditional spread.
    ...(() => {
      const exitReasonDistribution = buildExitReasonDistribution(input);
      return exitReasonDistribution ? { exitReasonDistribution } : {};
    })(),
  };
}

// =============================================================================
// Quick win — coach corrections relay (twin of monthly `buildCoachCorrections`)
// =============================================================================

/// Relay the loader's pre-formatted coach corrections (`« Axe » : commentaire`)
/// verbatim, capped ≤20 + re-hardened defense-in-depth (the loader already
/// truncated each comment; safeFreeText strips bidi/zero-width even though the
/// schema also refines). REAL side only — training corrections never reach here.
/// `input.coachCorrections` defaults to `[]` when the loader did not wire it
/// (pre-quick-win callers / fixtures stay valid).
function buildCoachCorrections(input: BuilderInput): string[] {
  return (input.coachCorrections ?? []).slice(0, COACH_CORRECTIONS_MAX).map((s) => {
    const trimmed = s.trim();
    const truncated =
      trimmed.length > COACH_CORRECTION_ITEM_MAX_CHARS
        ? trimmed.slice(0, COACH_CORRECTION_ITEM_MAX_CHARS)
        : trimmed;
    return safeFreeText(truncated);
  });
}

/// Relay the loader's pre-shaped member screen notes (`{ pair, direction, kind,
/// note }`) verbatim, capped ≤20 + the `note` re-hardened defense-in-depth (the
/// loader already truncated to ~350; safeFreeText strips bidi/zero-width even
/// though the schema also refines). `pair`/`direction`/`kind` are structural
/// (not member free-text) so they pass through untouched. MEMBER free-text side —
/// the note is wrapped untrusted at the prompt boundary. `input.memberScreenNotes`
/// defaults to `[]` when the loader did not wire it (pre-feature callers / fixtures
/// stay valid).
function buildMemberScreenNotes(input: BuilderInput): WeeklySnapshot['memberScreenNotes'] {
  return (input.memberScreenNotes ?? []).slice(0, MEMBER_SCREEN_NOTES_MAX).map((n) => {
    const trimmed = n.note.trim();
    const truncated =
      trimmed.length > MEMBER_SCREEN_NOTE_ITEM_MAX_CHARS
        ? trimmed.slice(0, MEMBER_SCREEN_NOTE_ITEM_MAX_CHARS)
        : trimmed;
    return {
      pair: n.pair,
      direction: n.direction,
      kind: n.kind,
      note: safeFreeText(truncated),
    };
  });
}

/// V1.8 REFLECT — relay the loader-loaded member weekly-review answers (the
/// member's OWN words about their week) re-hardened defense-in-depth (trim +
/// truncate + safeFreeText, twin of the screen-notes re-harden — the loader
/// already truncated ~300 and the schema re-refines bidi). Returns `undefined`
/// when the loader wired no review OR when every answer sanitizes to empty
/// (bidi-only smuggle) so the builder omits the slice entirely (honest empty
/// state — never a shell of empty strings in the prompt). `bestPractice` is
/// the wizard's only optional answer: `''` after hardening normalizes back to
/// honest `null`. MEMBER free-text — wrapped untrusted at the prompt boundary.
function buildMemberWeeklyReview(
  input: BuilderInput,
): NonNullable<WeeklySnapshot['freeText']['memberWeeklyReview']> | undefined {
  const review = input.memberWeeklyReview;
  if (review === null || review === undefined) return undefined;
  const harden = (s: string): string => {
    const trimmed = s.trim();
    const truncated =
      trimmed.length > MEMBER_WEEKLY_REVIEW_FIELD_MAX_CHARS
        ? trimmed.slice(0, MEMBER_WEEKLY_REVIEW_FIELD_MAX_CHARS)
        : trimmed;
    return safeFreeText(truncated);
  };
  const biggestWin = harden(review.biggestWin);
  const biggestMistake = harden(review.biggestMistake);
  const bestPractice = review.bestPractice === null ? '' : harden(review.bestPractice);
  const lessonLearned = harden(review.lessonLearned);
  const nextWeekFocus = harden(review.nextWeekFocus);
  // A review whose every answer sanitizes to empty carries no member words —
  // omit the slice (never a shell of empty strings in the prompt).
  if (
    biggestWin.length === 0 &&
    biggestMistake.length === 0 &&
    bestPractice.length === 0 &&
    lessonLearned.length === 0 &&
    nextWeekFocus.length === 0
  ) {
    return undefined;
  }
  return {
    biggestWin,
    biggestMistake,
    bestPractice: bestPractice.length === 0 ? null : bestPractice,
    lessonLearned,
    nextWeekFocus,
  };
}

// =============================================================================
// Quick win — exit-reason distribution over the week's closed trades
// =============================================================================

/**
 * Quick win — fold the week's CLOSED trades into a per-`exitReason` distribution
 * (count per reason, FR label from `EXIT_REASON_LABELS`), frequency-sorted desc.
 * Only trades with a non-null `exitReason` are counted (the field is optional /
 * feature récente). Returns `undefined` when nothing qualifies so the builder
 * omits the slice entirely (honest empty state, never a fabricated "0"). Posture
 * §2 : the exitReason is the factual NATURE of the exit (how the position ended),
 * never a market judgement.
 */
function buildExitReasonDistribution(
  input: BuilderInput,
): WeeklySnapshot['exitReasonDistribution'] {
  const counts = new Map<keyof typeof EXIT_REASON_LABELS, number>();
  for (const trade of input.trades) {
    if (!trade.isClosed) continue;
    const slug = trade.exitReason;
    // Skip trades with no recorded exit reason (null in DB, or undefined when a
    // caller omits the field) — an untagged exit is not a distribution bucket.
    if (slug === null || slug === undefined) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({ slug, label: EXIT_REASON_LABELS[slug], count }));
}

// =============================================================================
// Pattern signals slice — behaviour→outcome cross-cuts (S15 #7)
// =============================================================================

/**
 * Sample-gated pattern cross-cuts fed to the autonomous Claude run, which until
 * now saw only counters. Each sub-signal is built from data ALREADY loaded
 * (closed trades + the score history the loader passes) by the SAME pure
 * aggregators the member UI uses, with the SAME honest sample thresholds —
 * never a win-rate over 1 trade (§7.5 anti-noise). Posture §2: psychological &
 * process cross-cuts, never a market view. Returns `undefined` when nothing
 * clears its threshold.
 */
function buildPatternSignals(input: BuilderInput): WeeklySnapshot['patternSignals'] {
  const closed = input.trades.filter((t) => t.isClosed);

  // Top ENTRY emotion by volume (≥ sample gate) — emotion×outcome anchor.
  let topEntryEmotion: NonNullable<WeeklySnapshot['patternSignals']>['topEntryEmotion'];
  const topEmo = perEmotionField(closed, 'emotionBefore')
    .filter((r) => r.trades >= HOURLY_MIN_SAMPLE)
    .sort((a, b) => b.trades - a.trades)[0];
  if (topEmo) {
    topEntryEmotion = {
      slug: topEmo.slug,
      trades: topEmo.trades,
      winRatePct: topEmo.trades > 0 ? Math.round((topEmo.wins / topEmo.trades) * 100) : null,
    };
  }

  // Most-traded entry-hour band (≥ HOURLY_MIN_SAMPLE).
  let topHourBand: NonNullable<WeeklySnapshot['patternSignals']>['topHourBand'];
  const topBand = perHour(closed, input.timezone)
    .filter((b) => b.trades >= HOURLY_MIN_SAMPLE)
    .sort((a, b) => b.trades - a.trades)[0];
  if (topBand) {
    topHourBand = {
      slot: topBand.slot,
      label: topBand.label,
      trades: topBand.trades,
      winRatePct: Math.round(topBand.winRate * 100),
      avgR: roundTo(topBand.avgR, 2),
    };
  }

  // Intra-trade composure loss (entered serene → exited contrarié).
  let emotionArc: NonNullable<WeeklySnapshot['patternSignals']>['emotionArc'];
  const arc = emotionArcDegradation(closed);
  if (arc.count >= EMOTION_ARC_MIN_TO_SURFACE) {
    emotionArc = { count: arc.count, considered: arc.considered };
  }

  // Sustained multi-week declines (calm momentum signal). Empty → omit.
  const declines = detectMomentum(input.scoreHistory ?? []);
  const momentumDeclines =
    declines.length > 0
      ? declines.map((d) => ({
          dimension: d.dimension,
          label: d.label,
          weeklySlope: d.weeklySlope,
          points: d.points,
        }))
      : undefined;

  if (!topEntryEmotion && !topHourBand && !emotionArc && !momentumDeclines) {
    return undefined;
  }
  return {
    ...(topEntryEmotion ? { topEntryEmotion } : {}),
    ...(topHourBand ? { topHourBand } : {}),
    ...(emotionArc ? { emotionArc } : {}),
    ...(momentumDeclines ? { momentumDeclines } : {}),
  };
}

// =============================================================================
// Counters slice — pure numerics
// =============================================================================

function buildCounters(input: BuilderInput): WeeklySnapshot['counters'] {
  const closed = input.trades.filter((t) => t.isClosed);
  const open = input.trades.filter((t) => !t.isClosed);
  const wins = closed.filter((t) => t.outcome === 'win');
  const losses = closed.filter((t) => t.outcome === 'loss');
  const breakEvens = closed.filter((t) => t.outcome === 'break_even');

  // realizedR sum on ALL closed trades (estimated included — keeps the
  // outcome direction). For mean we ALSO include estimated to keep the
  // weekly snapshot informative — Phase C prompt will mention "n=X" so
  // Claude can interpret signal-to-noise.
  const realizedRs = closed
    .map((t) => parseRealizedR(t.realizedR))
    .filter((n): n is number => n !== null);
  const realizedRSum = realizedRs.reduce((s, n) => s + n, 0);
  const realizedRMean = realizedRs.length > 0 ? realizedRSum / realizedRs.length : null;

  // D3-04 — split the closed trades that carry a `realizedR` by the reliability
  // of that R (`realizedRSource`): `computed` (derived from a real SL) vs
  // `estimated` (fallback when the member skipped the SL). Lets Claude weight
  // the aggregated mean R by how trustworthy it is, instead of treating every
  // R as equally precise.
  const realizedRWithValue = closed.filter((t) => parseRealizedR(t.realizedR) !== null);
  const realizedRReliability = {
    computed: realizedRWithValue.filter((t) => t.realizedRSource === 'computed').length,
    estimated: realizedRWithValue.filter((t) => t.realizedRSource === 'estimated').length,
  };

  // Plan / hedge respect rates — closed trades only. Hedge rate excludes
  // nulls (N/A — trade was not a hedge candidate).
  const planRespectedCount = closed.filter((t) => t.planRespected).length;
  const planRespectRate = closed.length > 0 ? planRespectedCount / closed.length : null;
  const hedgeApplicable = closed.filter((t) => t.hedgeRespected !== null);
  const hedgeRespected = hedgeApplicable.filter((t) => t.hedgeRespected === true).length;
  const hedgeRespectRate =
    hedgeApplicable.length > 0 ? hedgeRespected / hedgeApplicable.length : null;

  // Check-ins — split by slot.
  const morningCheckins = input.checkins.filter((c) => c.slot === 'morning');
  const eveningCheckins = input.checkins.filter((c) => c.slot === 'evening');

  // SPEC §28/§21 — Session-2 process/habit axes surfaced as EXPLICIT NAMED
  // RATES (count-only, posture §2 — they measure the ACT, never P&L) so the
  // autonomous Claude analyses can reason on each axis BY NAME, not only via
  // the rolled-up discipline/engagement scores. Each rate mirrors the
  // corresponding scoring sub-score denominator EXACTLY: "answered" only
  // (`!== null`), `null` when nobody answered (no fake 0 %).
  //
  // "oublis" — closed trades where the process-completeness question was
  // answered (`processComplete !== null`).
  const processAnswered = closed.filter((t) => t.processComplete !== null);
  const processCompleteRate =
    processAnswered.length > 0
      ? processAnswered.filter((t) => t.processComplete === true).length / processAnswered.length
      : null;

  // "formation suivie" — EVENINGS where `formationFollowed` was answered.
  const formationAnswered = eveningCheckins.filter((c) => c.formationFollowed !== null);
  const formationFollowedRate =
    formationAnswered.length > 0
      ? formationAnswered.filter((c) => c.formationFollowed === true).length /
        formationAnswered.length
      : null;

  // "analyse de marché faite" — MORNINGS where `marketAnalysisDone` was answered.
  const marketAnalysisAnswered = morningCheckins.filter((c) => c.marketAnalysisDone !== null);
  const marketAnalysisDoneRate =
    marketAnalysisAnswered.length > 0
      ? marketAnalysisAnswered.filter((c) => c.marketAnalysisDone === true).length /
        marketAnalysisAnswered.length
      : null;

  // "routine matinale complétée" — MORNINGS where `morningRoutineCompleted` was
  // answered.
  const routineAnswered = morningCheckins.filter((c) => c.morningRoutineCompleted !== null);
  const morningRoutineCompletedRate =
    routineAnswered.length > 0
      ? routineAnswered.filter((c) => c.morningRoutineCompleted === true).length /
        routineAnswered.length
      : null;

  // "assiduité réunions" — completed / scheduled Fxmily meetings in the window
  // (count-only primitive). `rate` is `null` when nothing was scheduled (no
  // fake "0 %", mirror `computeMeetingAttendanceRate` honesty doctrine §30.4).
  const meetingScheduled = input.meetingScheduledCount ?? 0;
  const meetingCompleted = input.meetingCompletedCount ?? 0;
  const meetingAttendanceRate =
    meetingScheduled > 0 ? Math.min(1, meetingCompleted / meetingScheduled) : null;

  // Streak — derived from the unique check-in dates within the window.
  const checkinDates = new Set(input.checkins.map((c) => c.date));
  const streakDays = checkinDates.size;

  // Sleep / mood / stress — medians over the slot data that contains them.
  const sleepHours = morningCheckins
    .map((c) => parseDecimalOrNull(c.sleepHours))
    .filter((n): n is number => n !== null);
  const moodScores = input.checkins.map((c) => c.moodScore).filter((n): n is number => n !== null);
  const stressScores = eveningCheckins
    .map((c) => c.stressScore)
    .filter((n): n is number => n !== null);

  // SPEC §7.10/§30 — routine & lifestyle signals (count-only, posture §2 — the
  // ACT/the routine, NEVER a market view). These were collected at check-in
  // (morning: sleepQuality/meditation/sport ; evening: gratitude) but never
  // surfaced to the autonomous run. Honest medians/counts: `null`/0 when the
  // axis isn't filled (never a fake "0"). Mark Douglas mode-de-vie/routines
  // axis (§23/§30 — emotional regulation & discipline), never P&L. Carbon monthly.
  const sleepQualityScores = morningCheckins
    .map((c) => c.sleepQuality)
    .filter((n): n is number => n !== null);
  const meditationMinutes = morningCheckins
    .map((c) => c.meditationMin)
    .filter((n): n is number => n !== null && n > 0);
  const meditationDaysCount = new Set(
    morningCheckins
      .filter((c) => c.meditationMin !== null && c.meditationMin > 0)
      .map((c) => c.date),
  ).size;
  const sportDaysCount = new Set(
    morningCheckins
      .filter(
        (c) =>
          (c.sportDurationMin !== null && c.sportDurationMin > 0) ||
          (c.sportType !== null && c.sportType.trim() !== ''),
      )
      .map((c) => c.date),
  ).size;
  const gratitudeDaysCount = new Set(
    eveningCheckins.filter((c) => c.gratitudeItems.length > 0).map((c) => c.date),
  ).size;

  // Mark Douglas deliveries — split by state.
  const cardsSeen = input.deliveries.filter((d) => d.seenAt !== null).length;
  const cardsHelpful = input.deliveries.filter((d) => d.helpful === true).length;

  // V1.5 — Steenbarger setup quality distribution (NULL trades excluded).
  const tradesQualityA = input.trades.filter((t) => t.tradeQuality === 'A').length;
  const tradesQualityB = input.trades.filter((t) => t.tradeQuality === 'B').length;
  const tradesQualityC = input.trades.filter((t) => t.tradeQuality === 'C').length;
  const tradesQualityCaptured = tradesQualityA + tradesQualityB + tradesQualityC;

  // V1.5 — Tharp risk %. Median over captured values + Tharp-ceiling violations.
  const riskPcts = input.trades
    .map((t) => parseRiskPct(t.riskPct))
    .filter((n): n is number => n !== null);
  const riskPctMedian = median(riskPcts);
  const riskPctOverTwoCount = riskPcts.filter((v) => v > 2).length;

  // Quick win — longest run of consecutive losing closed trades in the window
  // (`computeMaxConsecutiveLoss` sorts by `exitedAt` and breaks the streak on a
  // win / break-even / open trade). Mark Douglas grid (5 vérités #1/#3): a loss
  // streak in a small sample is normal variance, not a broken edge — surfaced so
  // Claude names it calmly, never a market view.
  const maxConsecutiveLoss = computeMaxConsecutiveLoss(input.trades);

  return {
    tradesTotal: input.trades.length,
    tradesWin: wins.length,
    tradesLoss: losses.length,
    tradesBreakEven: breakEvens.length,
    tradesOpen: open.length,
    realizedRSum: roundTo(realizedRSum, 4),
    realizedRMean: realizedRMean === null ? null : roundTo(realizedRMean, 4),
    // D3-04 — reliability split of the aggregated R (computed vs estimated).
    realizedRReliability,
    planRespectRate: planRespectRate === null ? null : roundTo(planRespectRate, 4),
    hedgeRespectRate: hedgeRespectRate === null ? null : roundTo(hedgeRespectRate, 4),
    // SPEC §28/§21 — Session-2 process/habit axes as explicit named rates.
    processCompleteRate: processCompleteRate === null ? null : roundTo(processCompleteRate, 4),
    formationFollowedRate:
      formationFollowedRate === null ? null : roundTo(formationFollowedRate, 4),
    marketAnalysisDoneRate:
      marketAnalysisDoneRate === null ? null : roundTo(marketAnalysisDoneRate, 4),
    morningRoutineCompletedRate:
      morningRoutineCompletedRate === null ? null : roundTo(morningRoutineCompletedRate, 4),
    meetingAttendance: {
      scheduled: meetingScheduled,
      completed: meetingCompleted,
      rate: meetingAttendanceRate === null ? null : roundTo(meetingAttendanceRate, 4),
    },
    morningCheckinsCount: morningCheckins.length,
    eveningCheckinsCount: eveningCheckins.length,
    // Tour 14 — off days in the window (loader-precomputed, count-only). A jour
    // off is a choice of process, never a missing check-in (§31.2).
    offDaysCount: Math.max(0, input.offDaysInWindow ?? 0),
    streakDays,
    sleepHoursMedian: median(sleepHours),
    moodMedian: median(moodScores),
    stressMedian: median(stressScores),
    // SPEC §7.10/§30 — routine & lifestyle counters (count-only, posture §2).
    sleepQualityMedian: median(sleepQualityScores),
    meditationMinMedian: median(meditationMinutes),
    meditationDaysCount,
    sportDaysCount,
    gratitudeDaysCount,
    annotationsReceived: input.annotationsReceived,
    annotationsViewed: input.annotationsViewed,
    douglasCardsDelivered: input.deliveries.length,
    douglasCardsSeen: cardsSeen,
    douglasCardsHelpful: cardsHelpful,
    // SPEC §21 J-T4 — "volume de pratique" (effort COUNT only, never P&L,
    // §21.5). The loader feeds `trainingActivityCount` from the count-only
    // primitive; absent → 0 (zero-regression for pre-J-T4 fixtures/callers).
    trainingSessionsCount: input.trainingActivityCount ?? 0,
    tradesQualityA,
    tradesQualityB,
    tradesQualityC,
    tradesQualityCaptured,
    riskPctMedian,
    riskPctOverTwoCount,
    // Quick win — longest consecutive-loss streak of the window (count-only).
    maxConsecutiveLoss,
  };
}

// =============================================================================
// Free-text slice — sanitized via safeFreeText
// =============================================================================

function buildFreeText(input: BuilderInput): WeeklySnapshot['freeText'] {
  // V1.8 REFLECT — undefined when the member submitted no review OR every
  // answer sanitized to empty → the conditional spread omits the key entirely
  // (honest empty state + exactOptionalPropertyTypes-safe).
  const memberWeeklyReview = buildMemberWeeklyReview(input);
  return {
    emotionTags: collectEmotionTags(input),
    // D3-01 — declared cognitive-bias tags (LESSOR/Steenbarger). Psycho
    // self-declaration, NEVER market advice (posture §2). Carried as
    // `{ tag, count }` (unlike the bare-string `emotionTags`) so the prompt can
    // render `tag×count` like the monthly path.
    behaviorTags: collectBehaviorTags(input),
    pairsTraded: collectPairs(input),
    sessionsTraded: collectSessions(input),
    journalExcerpts: collectJournalExcerpts(input),
    // TASK A — recent member MORNING intentions (twin of journalExcerpts, the
    // MATIN free-text). Auto-declared DATA, never instructions — wrapped
    // untrusted at the prompt boundary.
    morningIntentions: collectMorningIntentions(input),
    ...(memberWeeklyReview ? { memberWeeklyReview } : {}),
  };
}

function collectEmotionTags(input: BuilderInput): string[] {
  const counts = new Map<string, number>();
  // Emotions from trades (before + during + after — the full §22 axis, so the
  // weekly IA analysis sees the in-position affect, not just entry/exit).
  for (const trade of input.trades) {
    for (const tag of trade.emotionBefore) {
      bumpCount(counts, tag);
    }
    for (const tag of trade.emotionDuring) {
      bumpCount(counts, tag);
    }
    for (const tag of trade.emotionAfter) {
      bumpCount(counts, tag);
    }
  }
  // Emotions from check-ins.
  for (const checkin of input.checkins) {
    for (const tag of checkin.emotionTags) {
      bumpCount(counts, tag);
    }
  }
  // Sort by frequency desc, dedupe, cap.
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, EMOTION_TAGS_MAX)
    .map(([tag]) => tag);
}

/**
 * D3-01 — Collect the post-outcome behavioural bias tags (CFA LESSOR +
 * Steenbarger : revenge-trade, loss-aversion, overconfidence…) declared on the
 * week's trades, sorted by frequency descending, capped at BEHAVIOR_TAGS_MAX.
 * Mirror of `collectEmotionTags` (count Map → sort desc → slice) but keeps the
 * count (`{ tag, count }`) so the prompt can render `tag×count`. These are
 * PSYCHOLOGICAL self-declarations — surfaced so Claude can name dominant
 * biases, NEVER a market signal (posture §2).
 */
function collectBehaviorTags(input: BuilderInput): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const trade of input.trades) {
    for (const tag of trade.tags) {
      bumpCount(counts, tag);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, BEHAVIOR_TAGS_MAX)
    .map(([tag, count]) => ({ tag, count }));
}

function collectPairs(input: BuilderInput): string[] {
  const counts = new Map<string, number>();
  for (const trade of input.trades) {
    bumpCount(counts, trade.pair);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, PAIRS_MAX)
    .map(([pair]) => pair);
}

function collectSessions(input: BuilderInput): WeeklySnapshot['freeText']['sessionsTraded'] {
  const counts = new Map<TradeSession, number>();
  for (const trade of input.trades) {
    bumpCount(counts, trade.session);
  }
  // Stable order: SESSIONS_ALL (asia, london, newyork, overlap) for snapshot
  // determinism (easier to diff fixtures across test runs).
  return SESSIONS_ALL.filter((s) => counts.has(s)).map((s) => ({
    session: s,
    count: counts.get(s) ?? 0,
  }));
}

function collectJournalExcerpts(input: BuilderInput): string[] {
  // Take recent evening check-ins with non-empty journalNote, sanitize +
  // truncate to 200 chars. Order: most recent first.
  const sorted = [...input.checkins].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const excerpts: string[] = [];
  for (const checkin of sorted) {
    if (excerpts.length >= JOURNAL_EXCERPTS_MAX) break;
    if (typeof checkin.journalNote !== 'string') continue;
    const trimmed = checkin.journalNote.trim();
    if (trimmed.length === 0) continue;
    const truncated =
      trimmed.length > JOURNAL_EXCERPT_MAX_CHARS
        ? trimmed.slice(0, JOURNAL_EXCERPT_MAX_CHARS) + '…'
        : trimmed;
    // Defense-in-depth: safeFreeText again here even though service layer
    // should have done it on read. Belt-and-suspenders for prompt injection.
    // Re-check post-sanitization: a zero-width-only note passes the `trimmed`
    // guard above but `safeFreeText` strips it to "" — never push an empty extract.
    const safe = safeFreeText(truncated);
    if (safe.length === 0) continue;
    excerpts.push(safe);
  }
  return excerpts;
}

/**
 * TASK A — collect the member's recent MORNING intentions from the week's
 * check-ins: most-recent first, `slot === 'morning'` + non-empty `intention`
 * only, sanitize + truncate to 200 chars, capped at {@link MORNING_INTENTIONS_MAX}.
 * EXACT twin of {@link collectJournalExcerpts} — same recency sort, same
 * sanitization, same anti-empty guard — but reads the MATIN free-text
 * (`c.intention`, written at the start of the day) on the `morning` slot instead
 * of the SOIR `journalNote`. Mark Douglas material (intention vs execution).
 * Auto-declared member DATA, never instructions — the prompt wraps each in the
 * canonical `<member_reflection_untrusted>` envelope (defense-in-depth).
 */
function collectMorningIntentions(input: BuilderInput): string[] {
  const sorted = [...input.checkins].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const intentions: string[] = [];
  for (const checkin of sorted) {
    if (intentions.length >= MORNING_INTENTIONS_MAX) break;
    if (checkin.slot !== 'morning') continue;
    if (typeof checkin.intention !== 'string') continue;
    const trimmed = checkin.intention.trim();
    if (trimmed.length === 0) continue;
    const truncated =
      trimmed.length > MORNING_INTENTION_MAX_CHARS
        ? trimmed.slice(0, MORNING_INTENTION_MAX_CHARS) + '…'
        : trimmed;
    // Defense-in-depth: safeFreeText again here even though service layer
    // should have done it on read. Belt-and-suspenders for prompt injection.
    // Re-check post-sanitization: a zero-width-only intention passes the
    // `trimmed` guard above but `safeFreeText` strips it to "" — never push empty.
    const safe = safeFreeText(truncated);
    if (safe.length === 0) continue;
    intentions.push(safe);
  }
  return intentions;
}

// =============================================================================
// Scores pass-through
// =============================================================================

function buildScores(input: BuilderInput): WeeklySnapshot['scores'] {
  if (input.latestScore === null) {
    return {
      discipline: null,
      emotionalStability: null,
      consistency: null,
      engagement: null,
    };
  }
  return {
    discipline: input.latestScore.discipline,
    emotionalStability: input.latestScore.emotionalStability,
    consistency: input.latestScore.consistency,
    engagement: input.latestScore.engagement,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function parseRealizedR(value: SerializedTrade['realizedR']): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRiskPct(value: SerializedTrade['riskPct']): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimalOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bumpCount<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a === undefined || b === undefined) return null;
    return roundTo((a + b) / 2, 4);
  }
  const v = sorted[mid];
  return v === undefined ? null : roundTo(v, 4);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
