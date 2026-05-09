/**
 * Pure aggregator that turns a 7-day slice of DB data into a
 * {@link WeeklySnapshot} ready to feed into Claude Sonnet 4.6 as the user
 * prompt payload (J8 — Phase A foundation, V1.5 pseudonymization).
 *
 * Posture (SPEC §2 + §20.4 + V1.5 pseudonymization) :
 *   - **Zero PII in the snapshot.** No email, no name, no raw cuid.
 *     `memberLabel` (e.g. `member-A1B2C3`) replaces `userId` at the prompt
 *     boundary — see `pseudonymizeMember` below.
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
const PAIRS_MAX = 10;
const SESSIONS_ALL: readonly TradeSession[] = ['asia', 'london', 'newyork', 'overlap'];

// =============================================================================
// Pseudonymization (V1.5 — prompt boundary defense)
// =============================================================================

/**
 * Map a member's `userId` (cuid) to a stable, non-reversible 24-bit label.
 *
 * `member-${SHA-256(userId)[0..6].toUpperCase()}` is :
 *   - deterministic (same userId → same label across runs)
 *   - one-way (no reverse map without a precomputed rainbow table)
 *   - human-readable for Eliot in admin reports
 *   - collision-free for cohorts up to ~16M members (24-bit hex space).
 *     Birthday-paradox 50% collision threshold ≈ 4096 members; for V1
 *     30-100 cohort the collision probability is < 1e-4. If we ever
 *     scale past 1000 members, swap to 32-bit (`slice(0, 8)`) or store
 *     a UUID v5 mapping in DB.
 *
 * Pure — no I/O, no `Date.now()`. Hash collision risk and label format
 * are exercised in `builder.test.ts` (V1.5 tests).
 */
export function pseudonymizeMember(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex').slice(0, 6).toUpperCase();
  return `member-${hash}`;
}

// =============================================================================
// Public entrypoint
// =============================================================================

export function buildWeeklySnapshot(input: BuilderInput): WeeklySnapshot {
  return {
    memberLabel: pseudonymizeMember(input.userId),
    timezone: input.timezone,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    counters: buildCounters(input),
    freeText: buildFreeText(input),
    scores: buildScores(input),
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

  return {
    tradesTotal: input.trades.length,
    tradesWin: wins.length,
    tradesLoss: losses.length,
    tradesBreakEven: breakEvens.length,
    tradesOpen: open.length,
    realizedRSum: roundTo(realizedRSum, 4),
    realizedRMean: realizedRMean === null ? null : roundTo(realizedRMean, 4),
    planRespectRate: planRespectRate === null ? null : roundTo(planRespectRate, 4),
    hedgeRespectRate: hedgeRespectRate === null ? null : roundTo(hedgeRespectRate, 4),
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
  };
}

// =============================================================================
// Free-text slice — sanitized via safeFreeText
// =============================================================================

function buildFreeText(input: BuilderInput): WeeklySnapshot['freeText'] {
  return {
    emotionTags: collectEmotionTags(input),
    pairsTraded: collectPairs(input),
    sessionsTraded: collectSessions(input),
    journalExcerpts: collectJournalExcerpts(input),
  };
}

function collectEmotionTags(input: BuilderInput): string[] {
  const counts = new Map<string, number>();
  // Emotions from trades (before + after entries).
  for (const trade of input.trades) {
    for (const tag of trade.emotionBefore) {
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
