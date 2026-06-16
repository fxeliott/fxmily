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

import type { SerializedTrade } from '@/lib/trades/service';
import { safeFreeText } from '@/lib/text/safe';

import type { BuilderInput, WeeklySnapshot } from './types';

const JOURNAL_EXCERPT_MAX_CHARS = 200;
const JOURNAL_EXCERPTS_MAX = 5;
const EMOTION_TAGS_MAX = 20;
// D3-01 — cap on the distinct behavioural bias tags (LESSOR/Steenbarger)
// surfaced to Claude. Lower than EMOTION_TAGS_MAX (20) : the bias allowlist is
// short (UI caps 3/trade) so 12 distinct tags is ample headroom for a week.
const BEHAVIOR_TAGS_MAX = 12;
const PAIRS_MAX = 10;
const SESSIONS_ALL: readonly TradeSession[] = ['asia', 'london', 'newyork', 'overlap'];

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
    streakDays,
    sleepHoursMedian: median(sleepHours),
    moodMedian: median(moodScores),
    stressMedian: median(stressScores),
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
  };
}

// =============================================================================
// Free-text slice — sanitized via safeFreeText
// =============================================================================

function buildFreeText(input: BuilderInput): WeeklySnapshot['freeText'] {
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
    excerpts.push(safeFreeText(truncated));
  }
  return excerpts;
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
