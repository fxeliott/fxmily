import 'server-only';

import { cache } from 'react';

import {
  buildEquityCurve,
  computeExpectancy,
  computeMaxConsecutiveLoss,
  computeMaxConsecutiveWin,
  computeMaxDrawdown,
  type EquityPoint,
  type ExpectancyResult,
  type DrawdownResult,
} from '@/lib/analytics';
import {
  localDateOf,
  localInstantToUtc,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  emotionArcDegradation,
  type EmotionArcDegradation,
  type EmotionPerfRow,
  type HourlyPerf,
  perEmotionField,
  perHour,
} from '@/lib/scoring/pattern-rhythms';
import {
  aggregateRiskDiscipline,
  aggregateSetupQuality,
  type RiskDiscipline,
  type SetupQualityDist,
} from '@/lib/scoring/setup-quality';
import { SESSION_LABEL } from '@/lib/trading/sessions';

export type { RiskDiscipline, SetupQualityDist } from '@/lib/scoring/setup-quality';
export type { EmotionPerfRow, HourlyPerf } from '@/lib/scoring/pattern-rhythms';

/**
 * Dashboard analytics aggregator (J6, SPEC §7.5).
 *
 * Fetches a member's relevant slice once (`Promise.all` parallel) and runs
 * every dashboard computation. Server Components consume this and pass
 * specific fields to client charts via the React 19 `use()` API.
 *
 * Mark Douglas posture is enforced at the data layer:
 *   - `expectancy` and `equityCurve` exclude `realizedRSource = 'estimated'`.
 *     The UI shows "X estimated trades excluded" when relevant.
 *   - All metrics carry an explicit sample-size flag so the surface can
 *     render disclaimers without re-running.
 *
 * Time semantics: window = N days ending on `asOf`-local. Default `asOf` is
 * "today" in user TZ — a live read, not the cron snapshot anchor (yesterday).
 * The cron snapshot is read separately via `getLatestBehavioralScore`.
 */

export type RangeKey = '7d' | '30d' | '3m' | '6m' | 'all';

const RANGE_DAYS: Record<RangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '3m': 90,
  '6m': 180,
  all: 3650,
};

export interface DashboardAnalytics {
  /** Local-day anchor used (today by default). */
  asOf: LocalDateString;
  windowDays: number;
  expectancy: ExpectancyResult;
  drawdown: DrawdownResult;
  equity: { points: EquityPoint[]; estimatedExcluded: number; invalidExcluded: number };
  rDistribution: RDistributionBucket[];
  pairTopFive: PairPerf[];
  sessionPerf: SessionPerf[];
  /** Entry-time rhythm in 4 Paris-wall-clock bands (finer than sessions). */
  hourlyPerf: HourlyPerf[];
  /** Emotion×outcome on the BEFORE moment (anchor table). */
  emotionPerf: EmotionPerfRow[];
  /** Emotion×outcome on the DURING moment (recalled at close). */
  emotionPerfDuring: EmotionPerfRow[];
  /** Emotion×outcome on the AFTER moment (recalled at close). */
  emotionPerfAfter: EmotionPerfRow[];
  /** S15 #5 — trades entered serene that turned contrarié during/after. */
  emotionArc: EmotionArcDegradation;
  streaks: { observedMaxLoss: number; observedMaxWin: number };
  /** Total closed trades in the window. */
  closedCount: number;
  estimatedCount: number;
  /** V1.5 — Steenbarger setup-quality distribution (A/B/C). NULL excluded. */
  setupQuality: SetupQualityDist;
  /** V1.5 — Tharp risk-ceiling discipline (riskPct ≤ 2 %). NULL excluded. */
  riskDiscipline: RiskDiscipline;
}

export interface RDistributionBucket {
  /** Bucket label, e.g. "-3R", "0R", "+1R", "+4R+". */
  label: string;
  /** Lower bound (inclusive) of the bucket. */
  from: number;
  /** Upper bound (exclusive). */
  to: number;
  count: number;
}

export interface PairPerf {
  pair: string;
  trades: number;
  winRate: number;
  avgR: number;
}

export interface SessionPerf {
  session: 'asia' | 'london' | 'newyork' | 'overlap';
  label: string;
  trades: number;
  winRate: number;
  avgR: number;
}

/**
 * Cached entry point. React 19 `cache()` scopes results to a single
 * request — when the dashboard renders `TrackRecordSection` and
 * `PatternsSection` in parallel under `<Suspense>`, only the first
 * call hits the DB ; the second resolves from the per-request cache.
 *
 * Note: cache key matches arguments by reference equality, so callers
 * must pass the same (userId, timezone, range[, asOf]) tuple to share
 * the cached result.
 */
export const getDashboardAnalytics = cache(_getDashboardAnalyticsImpl);

async function _getDashboardAnalyticsImpl(
  userId: string,
  timezone: string,
  range: RangeKey = '30d',
  asOf?: LocalDateString,
): Promise<DashboardAnalytics> {
  const windowDays = RANGE_DAYS[range];
  const today = localDateOf(new Date(), timezone);
  const anchor = asOf ?? today;
  const windowStart = shiftLocalDate(anchor, -(windowDays - 1));
  // TIME-1 (RC#8) — Trade.closedAt is a true UTC instant, so bucket it by the
  // real Paris civil-day boundary (DST-aware) instead of UTC-midnight pins, to
  // match the behavioral-scoring window (scoring/service.ts) and the weekly
  // report. UTC-midnight pins are 1-2h off and misfile late-evening trades.
  const windowStartUtc = localInstantToUtc(windowStart, 0, 0, 0, 0, timezone);
  const windowEndExclusive = localInstantToUtc(shiftLocalDate(anchor, 1), 0, 0, 0, 0, timezone);

  const trades = await db.trade.findMany({
    where: {
      userId,
      closedAt: { gte: windowStartUtc, lt: windowEndExclusive },
    },
    select: {
      pair: true,
      session: true,
      outcome: true,
      realizedR: true,
      realizedRSource: true,
      closedAt: true,
      exitedAt: true,
      enteredAt: true,
      emotionBefore: true,
      // V2 §7.5 — the during/after moments, captured at close (master prompt §22).
      emotionDuring: true,
      emotionAfter: true,
      // V1.5 process metrics (Steenbarger / Tharp) — set at entry time.
      tradeQuality: true,
      riskPct: true,
    },
    orderBy: { exitedAt: 'asc' },
  });

  const tradesNorm = trades.map((t) => ({
    ...t,
    realizedR: t.realizedR == null ? null : t.realizedR.toString(),
    riskPct: t.riskPct == null ? null : t.riskPct.toString(),
    closedAt: t.closedAt!.toISOString(),
    exitedAt: t.exitedAt ? t.exitedAt.toISOString() : null,
    enteredAt: t.enteredAt ? t.enteredAt.toISOString() : null,
    emotionBefore: [...(t.emotionBefore ?? [])],
    emotionDuring: [...(t.emotionDuring ?? [])],
    emotionAfter: [...(t.emotionAfter ?? [])],
  }));

  const expectancy = computeExpectancy(tradesNorm);
  const equity = buildEquityCurve(tradesNorm);
  const drawdown = computeMaxDrawdown(equity.points);

  const observedMaxLoss = computeMaxConsecutiveLoss(tradesNorm);
  const observedMaxWin = computeMaxConsecutiveWin(tradesNorm);

  const rDistribution = bucketRMultiples(tradesNorm);
  const pairTopFive = topNPairs(tradesNorm, 5);
  const sessionPerf = perSession(tradesNorm);
  const hourlyPerf = perHour(tradesNorm, timezone);
  const emotionPerf = perEmotionField(tradesNorm, 'emotionBefore');
  const emotionPerfDuring = perEmotionField(tradesNorm, 'emotionDuring');
  const emotionPerfAfter = perEmotionField(tradesNorm, 'emotionAfter');
  const emotionArc = emotionArcDegradation(tradesNorm);

  const closedCount = tradesNorm.length;
  const estimatedCount = tradesNorm.filter((t) => t.realizedRSource === 'estimated').length;
  const setupQuality = aggregateSetupQuality(tradesNorm);
  const riskDiscipline = aggregateRiskDiscipline(tradesNorm);

  return {
    asOf: anchor,
    windowDays,
    expectancy,
    drawdown,
    equity,
    rDistribution,
    pairTopFive,
    sessionPerf,
    hourlyPerf,
    emotionPerf,
    emotionPerfDuring,
    emotionPerfAfter,
    emotionArc,
    streaks: { observedMaxLoss, observedMaxWin },
    closedCount,
    estimatedCount,
    setupQuality,
    riskDiscipline,
  };
}

// ----- Helpers ---------------------------------------------------------------

function bucketRMultiples(
  trades: ReadonlyArray<{
    realizedR: string | null;
    realizedRSource: 'computed' | 'estimated' | null;
  }>,
): RDistributionBucket[] {
  // Buckets at 0.5R width, clipped to [-3, +4]. Outliers fold into the rims.
  const edges = [-Infinity, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, Infinity];
  const labels: string[] = [
    '<-3R',
    '-3R',
    '-2.5R',
    '-2R',
    '-1.5R',
    '-1R',
    '-0.5R',
    '0R',
    '+0.5R',
    '+1R',
    '+1.5R',
    '+2R',
    '+2.5R',
    '+3R',
    '+3R+',
  ];

  const buckets: RDistributionBucket[] = labels.map((label, i) => ({
    label,
    from: edges[i]!,
    to: edges[i + 1]!,
    count: 0,
  }));

  for (const t of trades) {
    if (t.realizedRSource === 'estimated') continue; // exclude
    if (t.realizedR === null) continue;
    const r = Number(t.realizedR);
    if (!Number.isFinite(r)) continue;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!;
      if (r >= b.from && r < b.to) {
        b.count++;
        break;
      }
    }
  }
  return buckets;
}

function topNPairs(
  trades: ReadonlyArray<{
    pair: string;
    outcome: 'win' | 'loss' | 'break_even' | null;
    realizedR: string | null;
    realizedRSource: 'computed' | 'estimated' | null;
  }>,
  n: number,
): PairPerf[] {
  const stats = new Map<string, { trades: number; wins: number; sumR: number; nR: number }>();
  for (const t of trades) {
    const e = stats.get(t.pair) ?? { trades: 0, wins: 0, sumR: 0, nR: 0 };
    e.trades++;
    if (t.outcome === 'win') e.wins++;
    if (t.realizedRSource === 'computed' && t.realizedR !== null) {
      const r = Number(t.realizedR);
      if (Number.isFinite(r)) {
        e.sumR += r;
        e.nR++;
      }
    }
    stats.set(t.pair, e);
  }
  return Array.from(stats.entries())
    .map(([pair, e]) => ({
      pair,
      trades: e.trades,
      winRate: e.trades > 0 ? e.wins / e.trades : 0,
      avgR: e.nR > 0 ? e.sumR / e.nR : 0,
    }))
    .sort((a, b) => b.trades - a.trades)
    .slice(0, n);
}

function perSession(
  trades: ReadonlyArray<{
    session: 'asia' | 'london' | 'newyork' | 'overlap';
    outcome: 'win' | 'loss' | 'break_even' | null;
    realizedR: string | null;
    realizedRSource: 'computed' | 'estimated' | null;
  }>,
): SessionPerf[] {
  const order: Array<SessionPerf['session']> = ['asia', 'london', 'overlap', 'newyork'];
  const stats = new Map<
    SessionPerf['session'],
    { trades: number; wins: number; sumR: number; nR: number }
  >();
  for (const s of order) stats.set(s, { trades: 0, wins: 0, sumR: 0, nR: 0 });
  for (const t of trades) {
    const e = stats.get(t.session)!;
    e.trades++;
    if (t.outcome === 'win') e.wins++;
    if (t.realizedRSource === 'computed' && t.realizedR !== null) {
      const r = Number(t.realizedR);
      if (Number.isFinite(r)) {
        e.sumR += r;
        e.nR++;
      }
    }
  }
  return order.map((s) => {
    const e = stats.get(s)!;
    return {
      session: s,
      label: SESSION_LABEL[s],
      trades: e.trades,
      winRate: e.trades > 0 ? e.wins / e.trades : 0,
      avgR: e.nR > 0 ? e.sumR / e.nR : 0,
    };
  });
}
