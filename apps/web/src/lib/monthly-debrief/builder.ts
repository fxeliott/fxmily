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

import { safeFreeText } from '@/lib/text/safe';

import { WEEKLY_CONTEXT_MAX, type MonthlySnapshot } from '@/lib/schemas/monthly-debrief';

import type { MonthlyBuilderInput } from './types';

const WEEKLY_CONTEXT_ITEM_MAX_CHARS = 900;

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
    weeklySummaries: buildWeeklySummaries(input),
    scores: buildScores(input),
  };
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

  const planRespectedCount = closed.filter((t) => t.planRespected).length;
  const planRespectRate = closed.length > 0 ? planRespectedCount / closed.length : null;
  const hedgeApplicable = closed.filter((t) => t.hedgeRespected !== null);
  const hedgeRespected = hedgeApplicable.filter((t) => t.hedgeRespected === true).length;
  const hedgeRespectRate =
    hedgeApplicable.length > 0 ? hedgeRespected / hedgeApplicable.length : null;

  const morningCheckins = input.checkins.filter((c) => c.slot === 'morning');
  const eveningCheckins = input.checkins.filter((c) => c.slot === 'evening');
  const distinctCheckinDays = new Set(input.checkins.map((c) => c.date)).size;

  const sleepHours = morningCheckins
    .map((c) => parseNumberOrNull(c.sleepHours))
    .filter((n): n is number => n !== null);
  const moodScores = input.checkins.map((c) => c.moodScore).filter((n): n is number => n !== null);
  const stressScores = eveningCheckins
    .map((c) => c.stressScore)
    .filter((n): n is number => n !== null);

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
    distinctCheckinDays,
    sleepHoursMedian: median(sleepHours),
    moodMedian: median(moodScores),
    stressMedian: median(stressScores),
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
  };
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
