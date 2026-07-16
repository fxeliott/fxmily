/**
 * PURE monthly aggregator (V1.4 — SPEC §25, J-M1). Turns a civil-month
 * slice of DB data into a {@link MonthlySnapshot} fed to the batch-local
 * Claude Max run as the user-prompt payload.
 *
 * Posture (carbon `weekly-report/builder.ts`):
 *   - **Zero PII** — `pseudonymLabel` is pre-computed by the loader at the
 *     Claude boundary (SPEC §25.2). This pure module never sees a raw
 *     userId/email, so it cannot leak one.
 *   - **`safeFreeText` on every member-/AI-controlled string** before it
 *     enters the snapshot (defense-in-depth, Trojan-Source canon).
 *   - **No analyse de marché.** Counters + a textual context only.
 *
 * 🚨 §21.5 (SPEC §25.7, BLOCKING). The TRAINING side is relayed verbatim
 * from {@link TrainingEffortInput} (count + recency + boolean). This file
 * carries ZERO `resultR` / `outcome` / `plannedRR` backtest token — the
 * REAL `outcome` it reads is `SerializedTrade.outcome` of a REAL trade
 * (legitimate real-edge P&L, the product). The blocking anti-leak suite
 * Block G pins the firewall (training-isolation only — the real section
 * MUST read real trades).
 *
 * Pure — no DB, no `Date.now()`, no I/O. Vitest-replayable on a fixture.
 */

import { renderCoachingContextSection } from '@/lib/coaching/engine';
import { safeFreeText } from '@/lib/text/safe';
import { EXIT_REASON_LABELS } from '@/lib/trading/exit-reasons';

import {
  FAVORITE_TITLE_MAX_CHARS,
  FAVORITES_PROMPT_MAX_ENTRIES,
  OBJECTIVES_RING_MAX,
  OBJECTIVES_TEXT_MAX_CHARS,
  PREVIOUS_DEBRIEF_RECO_MAX_CHARS,
  PREVIOUS_DEBRIEF_RECO_MAX_ITEMS,
  PREVIOUS_DEBRIEF_SUMMARY_MAX_CHARS,
  REFLECTION_FIELD_MAX_CHARS,
  REFLECTION_PROMPT_MAX_ENTRIES,
  WEEKLY_CONTEXT_MAX,
  type MonthlySnapshot,
} from '@/lib/schemas/monthly-debrief';

import type { MonthlyBuilderInput } from './types';

const EMOTION_TAGS_MAX = 20;

// D3-01 — cap on the distinct behavioural bias tags (LESSOR/Steenbarger)
// surfaced to Claude. Lower than EMOTION_TAGS_MAX (20) : the bias allowlist is
// short (UI caps 3/trade) so 12 distinct tags is ample headroom for a month.
const BEHAVIOR_TAGS_MAX = 12;

const WEEKLY_CONTEXT_ITEM_MAX_CHARS = 900;

// TASK D — recent member journal verbatim (carbon weekly `collectJournalExcerpts`):
// recency-sorted, safeFreeText + truncate ~200 chars, cap at JOURNAL_EXCERPTS_MAX.
const JOURNAL_EXCERPT_MAX_CHARS = 200;
const JOURNAL_EXCERPTS_MAX = 10;

// TASK A — recent member MORNING intention verbatim (twin of `collectJournalExcerpts`,
// the SOIR/journalNote path): same recency sort, same safeFreeText + truncate ~200
// chars, same cap. Reads `intention` (written the MATIN) on `slot === 'morning'`
// check-ins — Mark Douglas material (intention vs execution, process vs outcome).
const MORNING_INTENTION_MAX_CHARS = 200;
const MORNING_INTENTIONS_MAX = 10;

// TASK E — cap on the distinct Douglas card categories surfaced in the
// usefulness breakdown (the enum has 11 categories — 20 is ample headroom).
const HELPFUL_BY_CATEGORY_MAX = 20;

type StreakTradeInput = Pick<
  MonthlyBuilderInput['trades'][number],
  'outcome' | 'exitedAt' | 'closedAt'
>;

/**
 * DELIBERATE local copy of `lib/analytics/streaks.ts#computeMaxConsecutiveLoss`.
 * The monthly foundation must not import `@/lib/analytics` (§25.7 "no new edge
 * coupling", pinned by the anti-leak Block G test) — the streak math is ~15
 * pure lines, so the foundation carries its own copy instead of weakening the
 * firewall. Same rules as the source: chronological by `exitedAt` (fallback
 * `closedAt`), win / break-even breaks the streak, open trades are skipped.
 * Behaviour is locked by `builder.test.ts` (incl. the open-trade case).
 */
function computeMaxConsecutiveLoss(trades: readonly StreakTradeInput[]): number {
  const closed = trades
    .filter((t) => t.outcome != null && t.closedAt != null)
    .map((t) => ({
      outcome: t.outcome,
      ts: Date.parse(t.exitedAt ?? t.closedAt!),
    }))
    .filter((t) => Number.isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);

  let max = 0;
  let cur = 0;
  for (const t of closed) {
    if (t.outcome === 'loss') {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

export function buildMonthlySnapshot(input: MonthlyBuilderInput): MonthlySnapshot {
  return {
    pseudonymLabel: input.pseudonymLabel,
    timezone: input.timezone,
    monthStart: input.monthStart,
    monthEnd: input.monthEnd,
    accountAgeDaysInWindow: input.accountAgeDaysInWindow,
    real: buildRealCounters(input),
    // 🚨 §21.5 — relayed verbatim. The input type structurally carries no
    // backtest P&L, so the snapshot cannot expose one.
    training: {
      backtestCount: input.training.backtestCount,
      daysSinceLastBacktest: input.training.daysSinceLastBacktest,
      hasEverPractised: input.training.hasEverPractised,
    },
    emotionTags: collectEmotionTags(input),
    // D3-01 — declared cognitive-bias tags (LESSOR/Steenbarger). Psycho
    // self-declaration, NEVER market advice (posture §2).
    behaviorTags: collectBehaviorTags(input),
    weeklySummaries: buildWeeklySummaries(input),
    scores: buildScores(input),
    // DoD#3 / §29 "progression MESURABLE" — delta N-1 vs N ancré dans la série
    // réelle des scores comportementaux (ou `null` si pas de baseline / <2 points).
    scoreProgression: buildScoreProgression(input),
    // DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters, relayed verbatim
    // (the loader did the period-scoped read; the pure aggregator stays clock-free).
    // COUNT-ONLY posture §2 — factual numbers, never a market view.
    verification: input.verification,
    // TASK B (SPEC §25.2) — onboarding profile REFERENCE relayed (the loader
    // truncated it; safeFreeText re-hardens at the snapshot boundary). TEXT-only
    // context — NEVER scoring/edge (posture §2). `null` → the prompt omits it.
    memberProfile: buildMemberProfile(input),
    // TASK D — recent member journal verbatim (auto-declared DATA, never
    // instructions — wrapped untrusted at the prompt boundary).
    journalExcerpts: collectJournalExcerpts(input),
    // J5.1 — reflexions ABCD recentes (CBT Ellis) du membre : free-text auto-
    // declare (A/B/C/D), jamais des instructions -> wrapped untrusted au prompt.
    // Le helper borne aux N plus recentes + `safeFreeText`. [] quand aucune.
    reflections: buildReflections(input),
    // J5.7 — objectifs de process (anneaux + axe + methodGoal), via le SSOT
    // getProcessObjectives (ce que le membre voit sur /objectifs). Le helper borne
    // + safeFreeText ; `null` -> slice omise (exactOptionalPropertyTypes ->
    // conditional spread). Retrocompat : sans donnee d'objectif -> meme snapshot.
    ...(() => {
      const objectives = buildObjectives(input);
      return objectives ? { objectives } : {};
    })(),
    // J5.8 — fiches Mark Douglas favorites (titre + categorie), via le SSOT
    // listMyFavorites. Le helper borne + safeFreeText ; [] -> slice omise
    // (conditional spread). Retrocompat : sans favori -> meme snapshot.
    ...(() => {
      const favorites = buildFavorites(input);
      return favorites.length > 0 ? { favorites } : {};
    })(),
    // TASK A — recent member MORNING intentions (twin of journalExcerpts, the
    // MATIN free-text). Auto-declared DATA, never instructions — wrapped
    // untrusted at the prompt boundary.
    morningIntentions: collectMorningIntentions(input),
    // TASK E — per-category "fiche utile" breakdown (count-only, posture §2).
    helpfulByCategory: collectHelpfulByCategory(input),
    // J-AI corrections echo — the coach's TAGGED corrections on REAL trades
    // (`« Axe » : commentaire`, pre-formatted + capped by the loader). ADMIN
    // free-text → wrapped untrusted at the prompt boundary; re-hardened here
    // belt-and-suspenders (mirror buildWeeklySummaries). REAL side only (§21.5).
    coachCorrections: buildCoachCorrections(input),
    // Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    // trades RÉELS du mois — l'explication que le membre écrit à côté de son screen.
    // MEMBER free-text → wrapped untrusted au prompt boundary + re-hardened
    // (`safeFreeText`) defense-in-depth. L'IA la relie aux corrections du coach pour
    // personnaliser le suivi. Empty array when the member attached no note. REAL side
    // only (§21.5 keeps training notes out entirely).
    memberScreenNotes: buildMemberScreenNotes(input),
    // S5 §32-C/D — synthèse de coaching psychologique. Le loader fournit le
    // contexte STRUCTURÉ (DB) ; ici (pur) on le rend en bloc Markdown via le
    // moteur (SSOT du format). Absent → slice omis (exactOptionalPropertyTypes).
    // §2-safe : la copie est curée par le moteur (jamais un terme de marché).
    ...(input.coaching ? { coaching: renderCoachingContextSection(input.coaching) } : {}),
    // Quick win — factual exit-reason distribution over the month's CLOSED trades
    // (count per `Trade.exitReason`, FR label). Absent → slice omitted (no closed
    // trade carried an exitReason, feature récente). Posture §2 (factual, never a
    // market view). exactOptionalPropertyTypes → conditional spread.
    ...(() => {
      const exitReasonDistribution = buildExitReasonDistribution(input);
      return exitReasonDistribution ? { exitReasonDistribution } : {};
    })(),
    // J5.4 — continuite N-1 : rappel BORNE du debrief du mois precedent (notre
    // propre sortie IA deja validee). Le helper tronque aux bornes + re-harden
    // safeFreeText ; `null`/absent -> slice omise (exactOptionalPropertyTypes ->
    // conditional spread). Retrocompat : un membre sans debrief N-1 produit le
    // meme snapshot qu'avant.
    ...(() => {
      const previousDebrief = input.previousDebrief
        ? buildPreviousDebrief(input.previousDebrief)
        : null;
      return previousDebrief ? { previousDebrief } : {};
    })(),
  };
}

/**
 * J5.4 — coerce the loader's raw previous-month debrief into the BOUNDED N-1
 * continuity slice. `safeFreeText` re-hardens (defense-in-depth: validated at
 * write, but member-derived) + hard slice to the shared ceilings (SSOT
 * `PREVIOUS_DEBRIEF_*`, the schema `.max()` re-validates). Returns `null` when
 * the summary is empty post-sanitize (never a fabricated block) so the caller
 * omits the slice entirely.
 */
function buildPreviousDebrief(
  prev: NonNullable<MonthlyBuilderInput['previousDebrief']>,
): NonNullable<MonthlySnapshot['previousDebrief']> | null {
  const summaryReal = safeFreeText(prev.summaryReal.trim()).slice(
    0,
    PREVIOUS_DEBRIEF_SUMMARY_MAX_CHARS,
  );
  if (summaryReal.length === 0) return null;
  const recommendations = prev.recommendations
    .map((rec) => safeFreeText(rec.trim()).slice(0, PREVIOUS_DEBRIEF_RECO_MAX_CHARS))
    .filter((rec) => rec.length > 0)
    .slice(0, PREVIOUS_DEBRIEF_RECO_MAX_ITEMS);
  return { monthStart: prev.monthStart, summaryReal, recommendations };
}

/**
 * J5.1 — coerce the loader's raw ABCD reflections into the BOUNDED slice: keep
 * the N most recent (loader already ordered desc), hard-slice each field to
 * `REFLECTION_FIELD_MAX_CHARS`, `safeFreeText` re-hardens (defense-in-depth:
 * validated at write, but member-authored). Drops an entry whose any ABCD field
 * is empty post-sanitize (never a half-rendered reflection).
 */
function buildReflections(input: MonthlyBuilderInput): MonthlySnapshot['reflections'] {
  const clamp = (s: string): string => safeFreeText(s.trim()).slice(0, REFLECTION_FIELD_MAX_CHARS);
  return (input.reflections ?? [])
    .slice(0, REFLECTION_PROMPT_MAX_ENTRIES)
    .map((r) => ({
      date: r.date,
      triggerEvent: clamp(r.triggerEvent),
      beliefAuto: clamp(r.beliefAuto),
      consequence: clamp(r.consequence),
      disputation: clamp(r.disputation),
    }))
    .filter(
      (r) =>
        r.triggerEvent.length > 0 &&
        r.beliefAuto.length > 0 &&
        r.consequence.length > 0 &&
        r.disputation.length > 0,
    );
}

/**
 * J5.7 — coerce the loader's raw process objectives into the BOUNDED slice: keep
 * the rings (<=4, numeric labels), clamp the AI/deterministic text fields to
 * `OBJECTIVES_TEXT_MAX_CHARS` (+ safeFreeText), null-ify any empty text so the
 * schema's `.min(1)` never rejects. Returns `null` when there is NOTHING
 * meaningful (no scored ring, no axis, no method goal) so the caller omits the
 * slice entirely (honest empty state — never a fabricated objectives block).
 */
function buildObjectives(
  input: MonthlyBuilderInput,
): NonNullable<MonthlySnapshot['objectives']> | null {
  const src = input.objectives;
  if (!src) return null;
  const clamp = (s: string): string => safeFreeText(s.trim()).slice(0, OBJECTIVES_TEXT_MAX_CHARS);
  const rings = src.rings.slice(0, OBJECTIVES_RING_MAX).map((r) => ({
    label: r.label.trim().slice(0, 60),
    current: r.current,
    target: r.target,
    reached: r.reached,
  }));
  const axis = src.coachingAxis ? clamp(src.coachingAxis) : '';
  const coachingAxis = axis.length > 0 ? axis : null;
  let methodGoal: NonNullable<MonthlySnapshot['objectives']>['methodGoal'] = null;
  if (src.methodGoal) {
    const label = clamp(src.methodGoal.label);
    const hint = clamp(src.methodGoal.hint);
    if (label.length > 0 && hint.length > 0) {
      methodGoal = { label, hint, current: src.methodGoal.current, target: src.methodGoal.target };
    }
  }
  const hasScoredRing = rings.some((r) => r.current !== null);
  if (!hasScoredRing && coachingAxis === null && methodGoal === null) return null;
  return { rings, coachingAxis, methodGoal };
}

/**
 * J5.8 — coerce the loader's raw favorites into the BOUNDED slice: keep the N
 * most-recent (loader already ordered desc), clamp each title to
 * `FAVORITE_TITLE_MAX_CHARS` + safeFreeText, drop any whose title is empty
 * post-sanitize. Returns [] when none (caller omits the slice). Twin weekly/monthly.
 */
function buildFavorites(input: MonthlyBuilderInput): NonNullable<MonthlySnapshot['favorites']> {
  return (input.favorites ?? [])
    .slice(0, FAVORITES_PROMPT_MAX_ENTRIES)
    .map((f) => ({
      title: safeFreeText(f.title.trim()).slice(0, FAVORITE_TITLE_MAX_CHARS),
      category: f.category.trim().slice(0, 40),
    }))
    .filter((f) => f.title.length > 0);
}

// =============================================================================
// (A) REAL counters — pure numerics (carbon weekly `buildCounters`)
// =============================================================================

function buildRealCounters(input: MonthlyBuilderInput): MonthlySnapshot['real'] {
  const closed = input.trades.filter((t) => t.isClosed);
  const open = input.trades.filter((t) => !t.isClosed);
  const wins = closed.filter((t) => t.outcome === 'win');
  const losses = closed.filter((t) => t.outcome === 'loss');
  const breakEvens = closed.filter((t) => t.outcome === 'break_even');

  const realizedRs = closed
    .map((t) => parseNumberOrNull(t.realizedR))
    .filter((n): n is number => n !== null);
  const realizedRSum = realizedRs.reduce((s, n) => s + n, 0);
  const realizedRMean = realizedRs.length > 0 ? realizedRSum / realizedRs.length : null;

  // D3-04 — split the closed trades that carry a `realizedR` by the reliability
  // of that R (`realizedRSource`): `computed` (derived from a real SL) vs
  // `estimated` (fallback when the member skipped the SL). Lets Claude weight
  // the aggregated mean R by how trustworthy it is, instead of treating every
  // R as equally precise.
  const realizedRWithValue = closed.filter((t) => parseNumberOrNull(t.realizedR) !== null);
  const realizedRReliability = {
    computed: realizedRWithValue.filter((t) => t.realizedRSource === 'computed').length,
    estimated: realizedRWithValue.filter((t) => t.realizedRSource === 'estimated').length,
  };

  const planRespectedCount = closed.filter((t) => t.planRespected).length;
  const planRespectRate = closed.length > 0 ? planRespectedCount / closed.length : null;
  const hedgeApplicable = closed.filter((t) => t.hedgeRespected !== null);
  const hedgeRespected = hedgeApplicable.filter((t) => t.hedgeRespected === true).length;
  const hedgeRespectRate =
    hedgeApplicable.length > 0 ? hedgeRespected / hedgeApplicable.length : null;

  const morningCheckins = input.checkins.filter((c) => c.slot === 'morning');
  const eveningCheckins = input.checkins.filter((c) => c.slot === 'evening');
  const distinctCheckinDays = new Set(input.checkins.map((c) => c.date)).size;

  // SPEC §28/§21 — Session-2 process/habit axes surfaced as EXPLICIT NAMED
  // RATES (count-only, posture §2 — the ACT, never P&L) so the autonomous
  // monthly Claude run can reason on each axis BY NAME, not only via the
  // rolled-up discipline/engagement scores. Denominators mirror the scoring
  // sub-scores EXACTLY: "answered" only (`!== null`), `null` when nobody
  // answered (no fake 0 %). Carbon of the weekly builder.
  const processAnswered = closed.filter((t) => t.processComplete !== null);
  const processCompleteRate =
    processAnswered.length > 0
      ? processAnswered.filter((t) => t.processComplete === true).length / processAnswered.length
      : null;

  const formationAnswered = eveningCheckins.filter((c) => c.formationFollowed !== null);
  const formationFollowedRate =
    formationAnswered.length > 0
      ? formationAnswered.filter((c) => c.formationFollowed === true).length /
        formationAnswered.length
      : null;

  const marketAnalysisAnswered = morningCheckins.filter((c) => c.marketAnalysisDone !== null);
  const marketAnalysisDoneRate =
    marketAnalysisAnswered.length > 0
      ? marketAnalysisAnswered.filter((c) => c.marketAnalysisDone === true).length /
        marketAnalysisAnswered.length
      : null;

  const routineAnswered = morningCheckins.filter((c) => c.morningRoutineCompleted !== null);
  const morningRoutineCompletedRate =
    routineAnswered.length > 0
      ? routineAnswered.filter((c) => c.morningRoutineCompleted === true).length /
        routineAnswered.length
      : null;

  const meetingScheduled = input.meetingScheduledCount ?? 0;
  const meetingCompleted = input.meetingCompletedCount ?? 0;
  const meetingAttendanceRate =
    meetingScheduled > 0 ? Math.min(1, meetingCompleted / meetingScheduled) : null;

  const sleepHours = morningCheckins
    .map((c) => parseNumberOrNull(c.sleepHours))
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
  // axis (§23/§30 — emotional regulation & discipline), never P&L. Carbon weekly.
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

  const cardsSeen = input.deliveries.filter((d) => d.seenAt !== null).length;
  const cardsHelpful = input.deliveries.filter((d) => d.helpful === true).length;

  const tradesQualityA = input.trades.filter((t) => t.tradeQuality === 'A').length;
  const tradesQualityB = input.trades.filter((t) => t.tradeQuality === 'B').length;
  const tradesQualityC = input.trades.filter((t) => t.tradeQuality === 'C').length;
  const tradesQualityCaptured = tradesQualityA + tradesQualityB + tradesQualityC;

  const riskPcts = input.trades
    .map((t) => parseNumberOrNull(t.riskPct))
    .filter((n): n is number => n !== null);
  const riskPctMedian = median(riskPcts);
  const riskPctOverTwoCount = riskPcts.filter((v) => v > 2).length;

  // Quick win — longest run of consecutive losing closed trades in the month
  // (`computeMaxConsecutiveLoss` sorts by `exitedAt`, breaks the streak on a win /
  // break-even / open trade). Mark Douglas grid (5 vérités #1/#3): a loss streak
  // in a small sample is normal variance, not a broken edge — surfaced so the
  // debrief names it calmly, never a market view.
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
    distinctCheckinDays,
    // Tour 14 — off days in the month (loader-precomputed, count-only). A jour
    // off is a choice of process, never a missing check-in (§31.2).
    offDaysCount: Math.max(0, input.offDaysInWindow ?? 0),
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
    tradesQualityA,
    tradesQualityB,
    tradesQualityC,
    tradesQualityCaptured,
    riskPctMedian,
    riskPctOverTwoCount,
    // Quick win — longest consecutive-loss streak of the month (count-only).
    maxConsecutiveLoss,
  };
}

// =============================================================================
// Quick win — exit-reason distribution over the month's closed trades
// =============================================================================

/**
 * Quick win — fold the month's CLOSED trades into a per-`exitReason` distribution
 * (count per reason, FR label from `EXIT_REASON_LABELS`), frequency-sorted desc.
 * Only trades with a non-null `exitReason` are counted (the field is optional /
 * feature récente). Returns `undefined` when nothing qualifies so the aggregator
 * omits the slice entirely (honest empty state, never a fabricated "0"). Posture
 * §2 : the exitReason is the factual NATURE of the exit (how the position ended),
 * never a market judgement. Carbon of the weekly builder's helper.
 */
function buildExitReasonDistribution(
  input: MonthlyBuilderInput,
): MonthlySnapshot['exitReasonDistribution'] {
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
// Weekly-summaries context + scores
// =============================================================================

function buildWeeklySummaries(input: MonthlyBuilderInput): string[] {
  // INPUT context only (SPEC §25.3 — never an FK). Cap to ≤4 and re-harden
  // defense-in-depth even though weekly persist already sanitised them
  // (mirror builder journalExcerpts belt-and-suspenders).
  return input.weeklySummaries.slice(0, WEEKLY_CONTEXT_MAX).map((s) => {
    const trimmed = s.trim();
    const truncated =
      trimmed.length > WEEKLY_CONTEXT_ITEM_MAX_CHARS
        ? trimmed.slice(0, WEEKLY_CONTEXT_ITEM_MAX_CHARS)
        : trimmed;
    return safeFreeText(truncated);
  });
}

/// J-AI corrections echo — relay the loader's pre-formatted coach corrections
/// (`« Axe » : commentaire`) verbatim, capped ≤20 + re-hardened defense-in-depth
/// (the loader already truncated each comment; safeFreeText strips bidi/zero-width
/// even though the schema also refines). Belt-and-suspenders twin of
/// `buildWeeklySummaries`. REAL side only — training corrections never reach here.
function buildCoachCorrections(input: MonthlyBuilderInput): string[] {
  return input.coachCorrections.slice(0, 20).map((s) => {
    const trimmed = s.trim();
    const truncated =
      trimmed.length > WEEKLY_CONTEXT_ITEM_MAX_CHARS
        ? trimmed.slice(0, WEEKLY_CONTEXT_ITEM_MAX_CHARS)
        : trimmed;
    return safeFreeText(truncated);
  });
}

/// Relay the loader's pre-shaped member screen notes (`{ pair, direction, kind,
/// note }`) verbatim, capped ≤20 + the `note` re-hardened defense-in-depth (the
/// loader already truncated to ~350; safeFreeText strips bidi/zero-width even
/// though the schema also refines). `pair`/`direction`/`kind` are structural (not
/// member free-text) so they pass through untouched. MEMBER free-text side — the
/// note is wrapped untrusted at the prompt boundary. Belt-and-suspenders twin of
/// `buildCoachCorrections`. REAL side only — training notes never reach here.
function buildMemberScreenNotes(input: MonthlyBuilderInput): MonthlySnapshot['memberScreenNotes'] {
  // `?? []` mirrors the weekly builder: the field is required on
  // MonthlyBuilderInput, but an untyped caller / partial fixture omitting it
  // must degrade to "no notes", never throw.
  return (input.memberScreenNotes ?? []).slice(0, 20).map((n) => {
    const trimmed = n.note.trim();
    const truncated =
      trimmed.length > WEEKLY_CONTEXT_ITEM_MAX_CHARS
        ? trimmed.slice(0, WEEKLY_CONTEXT_ITEM_MAX_CHARS)
        : trimmed;
    return {
      pair: n.pair,
      direction: n.direction,
      kind: n.kind,
      note: safeFreeText(truncated),
    };
  });
}

function buildScores(input: MonthlyBuilderInput): MonthlySnapshot['scores'] {
  if (input.latestScore === null) {
    return { discipline: null, emotionalStability: null, consistency: null, engagement: null };
  }
  return {
    discipline: input.latestScore.discipline,
    emotionalStability: input.latestScore.emotionalStability,
    consistency: input.latestScore.consistency,
    engagement: input.latestScore.engagement,
  };
}

// =============================================================================
// DoD#3 / §29 "progression MESURABLE" — score progression (N-1 vs N delta)
// =============================================================================

/**
 * Compute the month-over-month behavioural-score progression from the raw
 * ascending trend series + the local month-start anchor.
 *
 * Sources (decision, documented):
 *   - `current` = the LAST point of the series (the most recent ≤ now). It is
 *     read from the SAME `scoreHistory` series as `previous` so both anchor
 *     dates are mutually consistent and the per-dimension delta is meaningful.
 *     (The snapshot's separate `scores` field keeps using `latestScore` /
 *     `getLatestBehavioralScore` unchanged — that is the dashboard photo, this
 *     is the trajectory.)
 *   - `previous` (baseline N-1) = the trend point whose `date` is the latest one
 *     `<= monthStartLocal` (string compare is correct on `YYYY-MM-DD`) — i.e. the
 *     member's score AS THEY ENTERED the month.
 *
 * Returns `null` (HONEST — no fabrication) when:
 *   - the series has < 2 points, OR
 *   - no point exists at/before `monthStartLocal` (no entry-of-month baseline), OR
 *   - the baseline and the current point are the SAME point (no movement to narrate).
 *
 * `delta` per dimension = `current − previous`, ONLY when BOTH values are
 * non-null (a dimension that was `insufficient_data` on either anchor → `null`
 * delta, never a fake number). Posture §2: internal psychological scores only.
 */
function buildScoreProgression(input: MonthlyBuilderInput): MonthlySnapshot['scoreProgression'] {
  const series = input.scoreHistory;
  if (series.length < 2) return null;

  // The series is ascending (loader contract), so the last element is the most
  // recent point = `current`.
  const current = series[series.length - 1];
  if (current === undefined) return null;

  // Baseline = the latest point at/before the 1st of the reporting month. The
  // series is ascending, so iterate from the end and take the first one whose
  // local-date anchor is `<= monthStartLocal`.
  let previous: (typeof series)[number] | undefined;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const point = series[i];
    if (point !== undefined && point.date <= input.monthStartLocal) {
      previous = point;
      break;
    }
  }
  if (previous === undefined) return null;
  // Same anchor as current ⇒ a single in-window point, nothing to compare.
  if (previous.date === current.date) return null;

  return {
    previous: {
      discipline: previous.discipline,
      emotionalStability: previous.emotionalStability,
      consistency: previous.consistency,
      engagement: previous.engagement,
    },
    current: {
      discipline: current.discipline,
      emotionalStability: current.emotionalStability,
      consistency: current.consistency,
      engagement: current.engagement,
    },
    delta: {
      discipline: deltaOf(current.discipline, previous.discipline),
      emotionalStability: deltaOf(current.emotionalStability, previous.emotionalStability),
      consistency: deltaOf(current.consistency, previous.consistency),
      engagement: deltaOf(current.engagement, previous.engagement),
    },
    previousDate: previous.date,
    currentDate: current.date,
  };
}

/** `current − previous` per dimension, ONLY when both bounds are non-null. */
function deltaOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

// =============================================================================
// Emotion tags (carbon weekly `collectEmotionTags` — FIX C S5 hardening)
// =============================================================================

/**
 * Collect emotion tags from trade before/during/after + checkin emotionTags,
 * sorted by frequency descending, capped at EMOTION_TAGS_MAX. Carbon of the
 * weekly builder's `collectEmotionTags` — idiom carbon accepted in this repo
 * (a shared util would cross the real-edge/monthly boundary for ~6 lines).
 */
function collectEmotionTags(input: MonthlyBuilderInput): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  // Trade emotions (before + during + after — full §22 axis).
  for (const trade of input.trades) {
    for (const tag of trade.emotionBefore) {
      bumpCount(counts, tag);
    }
    if (Array.isArray(trade.emotionDuring)) {
      for (const tag of trade.emotionDuring) {
        bumpCount(counts, tag);
      }
    }
    for (const tag of trade.emotionAfter) {
      bumpCount(counts, tag);
    }
  }
  // Check-in emotion tags.
  for (const checkin of input.checkins) {
    for (const tag of checkin.emotionTags) {
      bumpCount(counts, tag);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, EMOTION_TAGS_MAX)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * D3-01 — Collect the post-outcome behavioural bias tags (CFA LESSOR +
 * Steenbarger : revenge-trade, loss-aversion, overconfidence…) declared on the
 * month's trades, sorted by frequency descending, capped at BEHAVIOR_TAGS_MAX.
 * Mirror of `collectEmotionTags` (count Map → sort desc → slice → map). These
 * are PSYCHOLOGICAL self-declarations, surfaced so Claude can name dominant
 * biases — NEVER a market signal (posture §2).
 */
function collectBehaviorTags(input: MonthlyBuilderInput): Array<{ tag: string; count: number }> {
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

function bumpCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// =============================================================================
// TASK D — journal excerpts (carbon weekly `collectJournalExcerpts`)
// =============================================================================

/**
 * TASK D — collect the member's recent journal verbatim from the month's
 * check-ins: most-recent first, non-empty `journalNote` only, `safeFreeText`
 * + truncate to ~200 chars, capped at {@link JOURNAL_EXCERPTS_MAX}. EXACT carbon
 * of `weekly-report/builder.ts collectJournalExcerpts` (the loader already
 * serializes `journalNote` for the monthly slice). These are auto-declared
 * member DATA, never instructions — the prompt wraps them in the canonical
 * `<member_reflection_untrusted>` envelope (TASK F) for defense-in-depth.
 */
function collectJournalExcerpts(input: MonthlyBuilderInput): string[] {
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
    // Defense-in-depth: safeFreeText again here even though service/loader
    // should have done it on read. Belt-and-suspenders for prompt injection.
    // Re-check post-sanitization: a zero-width-only note passes the `trimmed`
    // guard above but `safeFreeText` strips it to "" — never push an empty extract.
    const safe = safeFreeText(truncated);
    if (safe.length === 0) continue;
    excerpts.push(safe);
  }
  return excerpts;
}

// =============================================================================
// TASK A — morning intentions (twin of `collectJournalExcerpts`, the MATIN path)
// =============================================================================

/**
 * TASK A — collect the member's recent MORNING intentions from the month's
 * check-ins: most-recent first, `slot === 'morning'` + non-empty `intention`
 * only, `safeFreeText` + truncate to ~200 chars, capped at
 * {@link MORNING_INTENTIONS_MAX}. EXACT twin of {@link collectJournalExcerpts}
 * — same recency sort, same sanitization, same anti-empty guard — but reads the
 * MATIN free-text (`c.intention`, written at the start of the day) on the
 * `morning` slot instead of the SOIR `journalNote`. The loader already
 * serializes `intention` for the monthly slice. Mark Douglas material
 * (intention vs execution, process vs outcome). These are auto-declared member
 * DATA, never instructions — the prompt wraps them in the canonical
 * `<member_reflection_untrusted>` envelope for defense-in-depth.
 */
function collectMorningIntentions(input: MonthlyBuilderInput): string[] {
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
    // Defense-in-depth: safeFreeText again here (belt-and-suspenders, prompt
    // injection). Re-check post-sanitization: a zero-width-only intention passes
    // the `trimmed` guard but `safeFreeText` strips it to "" — never push empty.
    const safe = safeFreeText(truncated);
    if (safe.length === 0) continue;
    intentions.push(safe);
  }
  return intentions;
}

// =============================================================================
// TASK E — Douglas-card usefulness breakdown by category (count-only)
// =============================================================================

/**
 * TASK E (SPEC §28/§30) — fold the month's Douglas-card deliveries into a
 * per-`cardCategory` usefulness breakdown (count-only, posture §2 — the ACT of
 * finding a card useful, NEVER a market view). One entry per category that had
 * ≥1 card SEEN, frequency-sorted by total-seen desc. Mirror of the
 * `collectBehaviorTags` idiom (Map → sort desc → slice → map). `helpful` ≤
 * `seen` by construction (a card is only "useful" once seen). Empty array when
 * no card was seen this month (honest empty state, never a fabricated entry).
 */
function collectHelpfulByCategory(
  input: MonthlyBuilderInput,
): Array<{ category: string; helpful: number; seen: number }> {
  const seenByCat = new Map<string, number>();
  const helpfulByCat = new Map<string, number>();
  for (const delivery of input.deliveries) {
    if (delivery.seenAt === null) continue; // breakdown is over SEEN cards only
    bumpCount(seenByCat, delivery.cardCategory);
    if (delivery.helpful === true) bumpCount(helpfulByCat, delivery.cardCategory);
  }
  return Array.from(seenByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, HELPFUL_BY_CATEGORY_MAX)
    .map(([category, seen]) => ({ category, helpful: helpfulByCat.get(category) ?? 0, seen }));
}

// =============================================================================
// TASK B — onboarding profile reference (relay + re-harden via safeFreeText)
// =============================================================================

/**
 * TASK B (SPEC §25.2) — relay the loader-truncated onboarding profile into the
 * snapshot, re-hardening every free-text field with `safeFreeText`
 * (defense-in-depth — the schema also transforms, neither relies on the other).
 * REFERENCE CONTEXT for the prompt TEXT only — this value is NEVER read by the
 * scoring/edge path (posture §2). `null` in → `null` out (the prompt then omits
 * the whole section, no fabricated axes §33.6).
 */
function buildMemberProfile(input: MonthlyBuilderInput): MonthlySnapshot['memberProfile'] {
  const p = input.memberProfile;
  if (p === null) return null;
  return {
    summary: safeFreeText(p.summary),
    axesPrioritaires: p.axesPrioritaires.map((a) => safeFreeText(a)),
    highlightLabels: p.highlightLabels.map((l) => safeFreeText(l)),
    // D1 (SPEC §25.2) — relay the loader-derived tone enums verbatim (already
    // Zod-validated at the loader boundary — a closed enum, no free-text to
    // sanitise). `null` when the member has no coaching register / learning
    // stage (the prompt then omits the tone consigne). REFERENCE for the TEXT
    // tone only — NEVER an input of the behavioural score (firewall §21.5).
    coachingRegister: p.coachingRegister ?? null,
    learningStage: p.learningStage ?? null,
  };
}

// =============================================================================
// Helpers (tiny pure utilities — carbon weekly builder; a shared extraction
// would scope-creep into the real-edge weekly module for ~5-line maths).
// =============================================================================

function parseNumberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
