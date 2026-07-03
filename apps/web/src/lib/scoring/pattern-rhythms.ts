/**
 * Pure aggregation helpers for the V2 "Patterns" analytics depth (SPEC §7.5):
 *   - `perEmotionField` — emotion×outcome over ANY of the three captured
 *     moments (`emotionBefore` / `emotionDuring` / `emotionAfter`).
 *   - `perHour` — entry-time rhythm in 4 readable Paris-wall-clock bands
 *     (Nuit / Matin / Après-midi / Soir), a finer granularity than the
 *     `perSession` UTC bands.
 *
 * No I/O, no DB, no `server-only`, no `Date.now()` — every export is a
 * deterministic transformation over already-serialized trade rows. Safe to
 * import directly in Vitest (mirrors `setup-quality.ts`). The timezone is
 * injected so the grouping is testable and DST-correct via `Intl`.
 *
 * Posture §2 / Mark Douglas, encoded structurally:
 *   - R-multiple stats consume ONLY `realizedRSource === 'computed'` rows
 *     (never `'estimated'`) — identical to `perEmotion` / `perSession` /
 *     `topNPairs` in `dashboard-data.ts`.
 *   - Honesty about thin samples is NOT done here (a count is always
 *     factual); the surface flags `< HOURLY_MIN_SAMPLE` instead of this
 *     module inventing a win-rate over 1 trade. We never fabricate a metric.
 */

import { NEGATIVE_TRADING_EMOTIONS, SERENE_ENTRY_EMOTIONS } from '@/lib/trading/emotions';

export interface EmotionPerfRow {
  /** Emotion tag slug (e.g. 'fomo', 'calm'). */
  slug: string;
  trades: number;
  wins: number;
  /** Sum of R over computed-source trades only. */
  sumR: number;
  /** Number of trades that contributed to sumR. */
  rTrades: number;
}

/** The three captured emotional moments (master prompt §22). */
export type EmotionField = 'emotionBefore' | 'emotionDuring' | 'emotionAfter';

/** Stable order of the four entry-time bands, earliest first. */
export type HourSlot = 'night' | 'morning' | 'afternoon' | 'evening';

export interface HourlyPerf {
  slot: HourSlot;
  /** FR label shown in the UI. */
  label: string;
  trades: number;
  winRate: number;
  avgR: number;
}

/**
 * Below this per-band sample the surface marks the band "échantillon
 * faible" and hides win-rate / avg R (a 100 % win-rate over 1 trade reads
 * as a signal; *Trading in the Zone* says the opposite). Mirrors
 * `MIN_SESSION_SAMPLE` in `session-perf-bars.tsx`.
 */
export const HOURLY_MIN_SAMPLE = 5;

/** Entry-band definitions: [startHour inclusive, endHour exclusive). */
const HOUR_BANDS: ReadonlyArray<{
  slot: HourSlot;
  label: string;
  startHour: number;
  endHour: number;
}> = [
  { slot: 'night', label: 'Nuit (0 h à 6 h)', startHour: 0, endHour: 6 },
  { slot: 'morning', label: 'Matin (6 h à 12 h)', startHour: 6, endHour: 12 },
  { slot: 'afternoon', label: 'Après-midi (12 h à 18 h)', startHour: 12, endHour: 18 },
  { slot: 'evening', label: 'Soir (18 h à 24 h)', startHour: 18, endHour: 24 },
];

type EmotionTradeLike = {
  outcome: 'win' | 'loss' | 'break_even' | null;
  realizedR: string | null;
  realizedRSource: 'computed' | 'estimated' | null;
} & Partial<Record<EmotionField, readonly string[]>>;

/**
 * Generalized emotion×outcome aggregation over ONE captured moment. Calqued
 * on the original `perEmotion` (which was `emotionBefore`-only): a trade with
 * no tag on `field` is skipped; each tag accrues trade/win counts, and R is
 * summed ONLY for `computed`-source rows. Output is unsorted (the surface
 * sorts by volume) — matches the legacy `perEmotion` contract.
 */
export function perEmotionField(
  trades: ReadonlyArray<EmotionTradeLike>,
  field: EmotionField,
): EmotionPerfRow[] {
  const stats = new Map<string, { trades: number; wins: number; sumR: number; rTrades: number }>();
  for (const t of trades) {
    const tags = t[field];
    if (!tags || tags.length === 0) continue;
    for (const slug of tags) {
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

/**
 * Extract the wall-clock hour (0–23) of a UTC instant in the given IANA
 * timezone via `Intl` — DST-correct, no library. Falls back to UTC on an
 * unknown tz (defensive, mirrors the `lib/checkin/timezone` helpers).
 * Returns `null` when the instant is unparseable.
 */
export function localHourOf(isoInstant: string, timezone: string): number | null {
  const instant = new Date(isoInstant);
  if (Number.isNaN(instant.getTime())) return null;

  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  });
  const hourPart = fmt.formatToParts(instant).find((p) => p.type === 'hour')?.value ?? '00';
  // en-GB renders midnight as `00` (not `24`); guard anyway.
  const hour = Number(hourPart);
  if (!Number.isInteger(hour)) return null;
  return hour === 24 ? 0 : hour;
}

/**
 * Group closed trades into 4 entry-time bands by their Paris wall-clock
 * entry hour, finer than `perSession`. Returns one row per band in a stable
 * earliest-first order so the surface renders a steady axis. A band with no
 * trades carries `trades: 0` and zeroed metrics (the surface shows "—" / a
 * "faible" flag, never a fabricated win-rate).
 *
 * R-multiple stats exclude `'estimated'` rows — identical posture to every
 * other aggregator here.
 */
export function perHour(
  trades: ReadonlyArray<{
    enteredAt: string | null;
    outcome: 'win' | 'loss' | 'break_even' | null;
    realizedR: string | null;
    realizedRSource: 'computed' | 'estimated' | null;
  }>,
  timezone: string,
): HourlyPerf[] {
  const stats = new Map<HourSlot, { trades: number; wins: number; sumR: number; nR: number }>();
  for (const b of HOUR_BANDS) stats.set(b.slot, { trades: 0, wins: 0, sumR: 0, nR: 0 });

  for (const t of trades) {
    if (t.enteredAt === null) continue;
    const hour = localHourOf(t.enteredAt, timezone);
    if (hour === null) continue;
    const band = HOUR_BANDS.find((b) => hour >= b.startHour && hour < b.endHour);
    if (!band) continue; // unreachable for 0..23, defensive
    const e = stats.get(band.slot)!;
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

  return HOUR_BANDS.map((b) => {
    const e = stats.get(b.slot)!;
    return {
      slot: b.slot,
      label: b.label,
      trades: e.trades,
      winRate: e.trades > 0 ? e.wins / e.trades : 0,
      avgR: e.nR > 0 ? e.sumR / e.nR : 0,
    };
  });
}

// -----------------------------------------------------------------------------
// S15 #5 — emotion-arc degradation (entered serene → lost composure)
// -----------------------------------------------------------------------------

/** Below this many degraded trades the surface stays silent (anti-noise: a
 *  single occurrence is not a pattern). Calm threshold, mirrors the repo's
 *  MIN_SAMPLE culture without claiming a win-rate. */
export const EMOTION_ARC_MIN_TO_SURFACE = 3;

export interface EmotionArcExample {
  /** Serene entry slug (e.g. 'calm'). */
  from: string;
  /** First negative slug found during/after (e.g. 'frustrated'). */
  to: string;
}

export interface EmotionArcDegradation {
  /** Trades entered serene that turned contrarié during or after. */
  count: number;
  /** Trades that entered serene at all (the population at risk — honest denominator). */
  considered: number;
  /** Up to 3 transition examples (slugs), for a concrete, non-fabricated illustration. */
  examples: EmotionArcExample[];
}

/**
 * Count trades where the member ENTERED composed (≥1 serene tag and NO negative
 * tag on `emotionBefore`) but lost composure DURING or AFTER (≥1 negative tag on
 * `emotionDuring ∪ emotionAfter`). This is the intra-trade emotional-control
 * marker (Mark Douglas) — independent of outcome/P&L, pure process mirror.
 *
 * No I/O, no DB, deterministic → Vitest-safe. Returns counts + a few concrete
 * transition examples; the surface adds the sample guard
 * (`EMOTION_ARC_MIN_TO_SURFACE`) and a CALM, non-judgmental wording (§2).
 */
export function emotionArcDegradation(
  trades: ReadonlyArray<{
    emotionBefore: readonly string[] | null;
    emotionDuring: readonly string[] | null;
    emotionAfter: readonly string[] | null;
  }>,
): EmotionArcDegradation {
  let count = 0;
  let considered = 0;
  const examples: EmotionArcExample[] = [];

  for (const t of trades) {
    const before = t.emotionBefore ?? [];
    if (before.length === 0) continue;

    const sereneEntry = before.find((s) => SERENE_ENTRY_EMOTIONS.has(s));
    const hasNegativeEntry = before.some((s) => NEGATIVE_TRADING_EMOTIONS.has(s));
    // "Entered serene" = at least one serene tag AND no negative tag at entry.
    if (sereneEntry === undefined || hasNegativeEntry) continue;
    considered++;

    const post = [...(t.emotionDuring ?? []), ...(t.emotionAfter ?? [])];
    const firstNegative = post.find((s) => NEGATIVE_TRADING_EMOTIONS.has(s));
    if (firstNegative === undefined) continue;

    count++;
    if (examples.length < 3) examples.push({ from: sereneEntry, to: firstNegative });
  }

  return { count, considered, examples };
}
