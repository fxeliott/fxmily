/**
 * Track-record metrics — pure functions, no DB, no side-effects.
 *
 * Sources :
 *   - Van Tharp expectancy formula (winRate * avgWinR) - (lossRate * |avgLossR|)
 *   - Wilson interval intentionally skipped here (n ≥ 30 always on this dataset)
 *   - Profit factor capped à 999 when zero loss for display sanity
 *   - Max drawdown computed on cumulative R curve (Van Tharp underwater)
 *
 * Convention : trades en INPUT ont resultR signe (positive = win, negative
 * = loss, exactement 0 = BE). riskPercent en pourcentage brut (1.0 = 1%).
 */

export interface RawTrade {
  /** Position chronologique 1..N. */
  ordinal: number;
  /** Segment historique / live. */
  segment: 'historical' | 'live';
  /** Pair / instrument. */
  instrument: string;
  /** Direction long/short ou null si inconnue. */
  direction: 'long' | 'short' | null;
  /** Date d'entrée (ISO string ou Date). */
  enteredAt: string | Date;
  /** % de capital risqué (1 = 1%, 2 = 2%, 0.5 = 0.5%). */
  riskPercent: number;
  /** R-multiple final. Null si open. */
  resultR: number | null;
  /** % portefeuille net (riskPercent × resultR). Null si open. */
  resultPercent: number | null;
  /** open / closed / break_even. */
  status: 'open' | 'closed' | 'break_even';
  /** Tags additionnels (FOMC, CPI, partage-live...). */
  tags: string[];
}

export interface EquityPoint {
  ordinal: number;
  /** % cumulé composé. Démarre à 0. */
  cumPercent: number;
  /** Underwater = cumPercent - peakCumPercent. ≤ 0. */
  underwater: number;
  enteredAt: Date;
}

export interface TrackRecordKpis {
  totalTrades: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  beCount: number;
  openCount: number;
  /** 0..1. */
  winrate: number;
  /** Mean R per closed trade (excludes open). */
  avgR: number;
  /** Sum of all R (closed). */
  totalR: number;
  /** Avg R on wins (positive). 0 if no wins. */
  avgWinR: number;
  /** Avg R on losses (negative). 0 if no losses. */
  avgLossR: number;
  /** Van Tharp expectancy in R per trade (closed). */
  expectancyR: number;
  /** Sum gains / Sum losses. ∞ if zero losses. */
  profitFactor: number;
  /** Cumulative % at end. */
  totalPercent: number;
  /** Max drawdown (% underwater, ≤ 0). */
  maxDrawdownPercent: number;
  /** Best streak (consecutive wins). */
  bestStreak: number;
  /** Worst streak (consecutive losses, returned as positive count). */
  worstStreak: number;
  /** First and last trade dates. */
  firstTradeAt: Date | null;
  lastTradeAt: Date | null;
}

const toDate = (d: string | Date): Date => (d instanceof Date ? d : new Date(d));

export function buildEquityCurve(trades: readonly RawTrade[]): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.ordinal - b.ordinal);
  let cum = 0;
  let peak = 0;
  return sorted.map((t) => {
    const pct = t.resultPercent ?? 0;
    cum += pct;
    if (cum > peak) peak = cum;
    return {
      ordinal: t.ordinal,
      cumPercent: cum,
      underwater: cum - peak,
      enteredAt: toDate(t.enteredAt),
    };
  });
}

export function computeKpis(trades: readonly RawTrade[]): TrackRecordKpis {
  const closed = trades.filter((t) => t.status !== 'open' && t.resultR !== null);
  const wins = closed.filter((t) => (t.resultR ?? 0) > 0);
  const losses = closed.filter((t) => (t.resultR ?? 0) < 0);
  const bes = closed.filter((t) => (t.resultR ?? 0) === 0);
  const opens = trades.filter((t) => t.status === 'open');

  const totalR = closed.reduce((s, t) => s + (t.resultR ?? 0), 0);
  const totalPercent = closed.reduce((s, t) => s + (t.resultPercent ?? 0), 0);
  const avgR = closed.length ? totalR / closed.length : 0;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + (t.resultR ?? 0), 0) / wins.length : 0;
  const avgLossR = losses.length
    ? losses.reduce((s, t) => s + (t.resultR ?? 0), 0) / losses.length
    : 0;

  const winrate = closed.length ? wins.length / closed.length : 0;
  const lossrate = closed.length ? losses.length / closed.length : 0;
  // Van Tharp expectancy (R per trade)
  const expectancyR = winrate * avgWinR + lossrate * avgLossR;

  const sumGains = wins.reduce((s, t) => s + (t.resultR ?? 0), 0);
  const sumLosses = Math.abs(losses.reduce((s, t) => s + (t.resultR ?? 0), 0));
  const profitFactor =
    sumLosses === 0 ? (sumGains > 0 ? Number.POSITIVE_INFINITY : 0) : sumGains / sumLosses;

  // Max drawdown on cumulative %
  const curve = buildEquityCurve(trades);
  const maxDrawdownPercent = curve.length ? Math.min(...curve.map((p) => p.underwater), 0) : 0;

  // Streaks
  let bestStreak = 0;
  let worstStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of closed) {
    const r = t.resultR ?? 0;
    if (r > 0) {
      curWin += 1;
      curLoss = 0;
      if (curWin > bestStreak) bestStreak = curWin;
    } else if (r < 0) {
      curLoss += 1;
      curWin = 0;
      if (curLoss > worstStreak) worstStreak = curLoss;
    } else {
      curWin = 0;
      curLoss = 0;
    }
  }

  const sortedByDate = [...trades]
    .filter((t) => t.enteredAt)
    .sort((a, b) => toDate(a.enteredAt).getTime() - toDate(b.enteredAt).getTime());

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    beCount: bes.length,
    openCount: opens.length,
    winrate,
    avgR,
    totalR,
    avgWinR,
    avgLossR,
    expectancyR,
    profitFactor,
    totalPercent,
    maxDrawdownPercent,
    bestStreak,
    worstStreak,
    firstTradeAt: sortedByDate.length ? toDate(sortedByDate[0]!.enteredAt) : null,
    lastTradeAt: sortedByDate.length
      ? toDate(sortedByDate[sortedByDate.length - 1]!.enteredAt)
      : null,
  };
}

/* ============================================================
 * Aggregation helpers — pure functions for charts and tables.
 * ============================================================ */

export interface MonthlyAggregate {
  /** UTC year-month "2025-01". */
  yearMonth: string;
  /** Human label "Janvier 2025". */
  label: string;
  monthNum: number; // 1..12
  year: number;
  count: number;
  winCount: number;
  lossCount: number;
  beCount: number;
  totalR: number;
  totalPercent: number;
  /** Winrate over closed (excl. BE). 0..1. */
  winrate: number;
}

const MONTH_LABELS_FR = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

export function groupByMonth(trades: readonly RawTrade[]): MonthlyAggregate[] {
  const buckets = new Map<string, MonthlyAggregate>();
  for (const t of trades) {
    const d = toDate(t.enteredAt);
    const year = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${year}-${String(m).padStart(2, '0')}`;
    let entry = buckets.get(key);
    if (!entry) {
      // B3 fix : noUncheckedIndexedAccess defensive — MONTH_LABELS_FR[m] is
      // string | undefined under strict TS. m always ∈ [1..12] (getUTCMonth + 1),
      // but coerce defensively to avoid "undefined 2025" if input is malformed.
      const monthLabel = MONTH_LABELS_FR[m] ?? `M${m}`;
      entry = {
        yearMonth: key,
        label: `${monthLabel} ${year}`,
        monthNum: m,
        year,
        count: 0,
        winCount: 0,
        lossCount: 0,
        beCount: 0,
        totalR: 0,
        totalPercent: 0,
        winrate: 0,
      };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const r = t.resultR ?? 0;
    if (t.status === 'break_even' || r === 0) entry.beCount += 1;
    else if (r > 0) entry.winCount += 1;
    else entry.lossCount += 1;
    entry.totalR += r;
    entry.totalPercent += t.resultPercent ?? 0;
  }
  // Compute winrate per bucket.
  for (const e of buckets.values()) {
    const closed = e.winCount + e.lossCount;
    e.winrate = closed > 0 ? e.winCount / closed : 0;
  }
  return [...buckets.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

export interface RBucket {
  /** Lower bound of the bucket (inclusive), e.g. -2.0. */
  lower: number;
  /** Upper bound of the bucket (exclusive), e.g. -1.5. */
  upper: number;
  /** Label "-2 / -1.5". */
  label: string;
  count: number;
  /** Win/loss/BE marker for color. */
  tone: 'gain' | 'loss' | 'be';
}

/** Bucket trades by R-multiple into 0.5R-wide bins from min..max. */
export function bucketByR(trades: readonly RawTrade[], step = 0.5): RBucket[] {
  const rs = trades.map((t) => t.resultR).filter((r): r is number => r !== null && r !== undefined);
  if (!rs.length) return [];
  const min = Math.min(...rs);
  const max = Math.max(...rs);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const buckets: RBucket[] = [];
  for (let b = lo; b < hi; b += step) {
    const upper = +(b + step).toFixed(2);
    const lower = +b.toFixed(2);
    const tone: RBucket['tone'] =
      lower < 0 ? 'loss' : lower === 0 && upper === step ? 'be' : 'gain';
    buckets.push({ lower, upper, label: `${lower}`, count: 0, tone });
  }
  for (const r of rs) {
    const idx = Math.floor((r - lo) / step);
    const clamped = Math.min(buckets.length - 1, Math.max(0, idx));
    const bucket = buckets[clamped];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export interface InstrumentAggregate {
  instrument: string;
  count: number;
  totalR: number;
  winCount: number;
  lossCount: number;
  beCount: number;
  winrate: number;
}

export function groupByInstrument(trades: readonly RawTrade[]): InstrumentAggregate[] {
  const map = new Map<string, InstrumentAggregate>();
  for (const t of trades) {
    let entry = map.get(t.instrument);
    if (!entry) {
      entry = {
        instrument: t.instrument,
        count: 0,
        totalR: 0,
        winCount: 0,
        lossCount: 0,
        beCount: 0,
        winrate: 0,
      };
      map.set(t.instrument, entry);
    }
    entry.count += 1;
    const r = t.resultR ?? 0;
    entry.totalR += r;
    if (t.status === 'break_even' || r === 0) entry.beCount += 1;
    else if (r > 0) entry.winCount += 1;
    else entry.lossCount += 1;
  }
  for (const e of map.values()) {
    const closed = e.winCount + e.lossCount;
    e.winrate = closed > 0 ? e.winCount / closed : 0;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function bestTrades(trades: readonly RawTrade[], n = 5): RawTrade[] {
  return [...trades]
    .filter((t) => t.resultR !== null && t.resultR !== undefined && t.resultR > 0)
    .sort((a, b) => (b.resultR ?? 0) - (a.resultR ?? 0))
    .slice(0, n);
}

export function worstTrades(trades: readonly RawTrade[], n = 5): RawTrade[] {
  return [...trades]
    .filter((t) => t.resultR !== null && t.resultR !== undefined && t.resultR < 0)
    .sort((a, b) => (a.resultR ?? 0) - (b.resultR ?? 0))
    .slice(0, n);
}
