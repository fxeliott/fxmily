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
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { SESSION_LABEL } from '@/lib/trading/sessions';

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
  emotionPerf: EmotionPerfRow[];
  streaks: { observedMaxLoss: number; observedMaxWin: number };
  /** Total closed trades in the window. */
  closedCount: number;
  estimatedCount: number;
}

export interface EmotionPerfRow {
  slug: string;
  trades: number;
  wins: number;
  sumR: number;
  rTrades: number;
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
  const windowStartUtc = parseLocalDate(windowStart);
  const windowEndExclusive = parseLocalDate(shiftLocalDate(anchor, 1));

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
      emotionBefore: true,
    },
    orderBy: { exitedAt: 'asc' },
  });

  const tradesNorm = trades.map((t) => ({
    ...t,
    realizedR: t.realizedR == null ? null : t.realizedR.toString(),
    closedAt: t.closedAt!.toISOString(),
    exitedAt: t.exitedAt ? t.exitedAt.toISOString() : null,
    emotionBefore: [...(t.emotionBefore ?? [])],
  }));

  const expectancy = computeExpectancy(tradesNorm);
  const equity = buildEquityCurve(tradesNorm);
  const drawdown = computeMaxDrawdown(equity.points);

  const observedMaxLoss = computeMaxConsecutiveLoss(tradesNorm);
  const observedMaxWin = computeMaxConsecutiveWin(tradesNorm);

  const rDistribution = bucketRMultiples(tradesNorm);
  const pairTopFive = topNPairs(tradesNorm, 5);
  const sessionPerf = perSession(tradesNorm);
  const emotionPerf = perEmotion(tradesNorm);

  const closedCount = tradesNorm.length;
  const estimatedCount = tradesNorm.filter((t) => t.realizedRSource === 'estimated').length;

  return {
    asOf: anchor,
    windowDays,
    expectancy,
    drawdown,
    equity,
    rDistribution,
    pairTopFive,
    sessionPerf,
    emotionPerf,
    streaks: { observedMaxLoss, observedMaxWin },
    closedCount,
    estimatedCount,
  };
}

function perEmotion(
  trades: ReadonlyArray<{
    emotionBefore: readonly string[];
    outcome: 'win' | 'loss' | 'break_even' | null;
    realizedR: string | null;
    realizedRSource: 'computed' | 'estimated' | null;
  }>,
): EmotionPerfRow[] {
  const stats = new Map<string, { trades: number; wins: number; sumR: number; rTrades: number }>();
  for (const t of trades) {
    if (!t.emotionBefore || t.emotionBefore.length === 0) continue;
    for (const slug of t.emotionBefore) {
      const e = stats.get(slug) ?? { trades: 0, wins: 0, sumR: 0, rTrades: 0 };
      e.trades++;
      if (t.outcome === 'win') e.wins++;
      if (t.realizedRSource === 'computed' && t.realizedR !== null) {
        const r = Number(t.realizedR);
        if (Number.isFinite(r)) {
          e.sumR += r;
          e.rTrades++;
        }
      }
      stats.set(slug, e);
    }
  }
  return Array.from(stats.entries()).map(([slug, e]) => ({ slug, ...e }));
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
