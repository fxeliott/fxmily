import { describe, expect, it } from 'vitest';

import {
  emotionArcDegradation,
  EMOTION_ARC_MIN_TO_SURFACE,
  type EmotionField,
  HOURLY_MIN_SAMPLE,
  type HourSlot,
  localHourOf,
  perEmotionField,
  perHour,
} from './pattern-rhythms';

// -----------------------------------------------------------------------------
// Helpers — inline trade builders, golden values commented (mirror of
// habit-trade-correlation.test.ts). Keeps each case readable without a fixture
// file and without ever touching the DB.
// -----------------------------------------------------------------------------

type EmoTrade = {
  outcome: 'win' | 'loss' | 'break_even' | null;
  realizedR: string | null;
  realizedRSource: 'computed' | 'estimated' | null;
  emotionBefore?: readonly string[];
  emotionDuring?: readonly string[];
  emotionAfter?: readonly string[];
};

function emo(
  field: EmotionField,
  tags: readonly string[],
  outcome: EmoTrade['outcome'],
  realizedR: string | null,
  source: EmoTrade['realizedRSource'] = 'computed',
): EmoTrade {
  return { [field]: tags, outcome, realizedR, realizedRSource: source };
}

type HourTrade = {
  enteredAt: string | null;
  outcome: 'win' | 'loss' | 'break_even' | null;
  realizedR: string | null;
  realizedRSource: 'computed' | 'estimated' | null;
};

function hourTrade(
  enteredAt: string | null,
  outcome: HourTrade['outcome'],
  realizedR: string | null,
  source: HourTrade['realizedRSource'] = 'computed',
): HourTrade {
  return { enteredAt, outcome, realizedR, realizedRSource: source };
}

const PARIS = 'Europe/Paris';

// =============================================================================
// perEmotionField — generalized over the three captured moments (§7.5)
// =============================================================================
describe('perEmotionField', () => {
  it('returns [] when no trade carries a tag on the chosen field', () => {
    // Tags live on `emotionBefore`, but we aggregate `emotionDuring` → empty.
    const trades = [emo('emotionBefore', ['calm'], 'win', '1.0')];
    expect(perEmotionField(trades, 'emotionDuring')).toEqual([]);
    expect(perEmotionField(trades, 'emotionAfter')).toEqual([]);
  });

  it('aggregates the DURING moment independently of BEFORE/AFTER', () => {
    const trades: EmoTrade[] = [
      { ...emo('emotionDuring', ['anxious'], 'win', '2.0'), emotionBefore: ['calm'] },
      { ...emo('emotionDuring', ['anxious'], 'loss', '-1.0'), emotionBefore: ['fomo'] },
    ];
    const during = perEmotionField(trades, 'emotionDuring');
    expect(during).toEqual([{ slug: 'anxious', trades: 2, wins: 1, sumR: 1, rTrades: 2 }]);
    // The BEFORE field of the same rows is a separate, correct aggregation.
    const before = perEmotionField(trades, 'emotionBefore');
    expect(before.map((r) => r.slug).sort()).toEqual(['calm', 'fomo']);
  });

  it('aggregates the AFTER moment; a multi-tag trade counts toward each tag', () => {
    const trades = [emo('emotionAfter', ['frustrated', 'doubt'], 'loss', '-2.0')];
    const after = perEmotionField(trades, 'emotionAfter');
    expect(after).toEqual([
      { slug: 'frustrated', trades: 1, wins: 0, sumR: -2, rTrades: 1 },
      { slug: 'doubt', trades: 1, wins: 0, sumR: -2, rTrades: 1 },
    ]);
  });

  it('EXCLUDES estimated-source R from sumR/rTrades but still counts the trade', () => {
    const trades = [
      emo('emotionDuring', ['calm'], 'win', '3.0', 'estimated'), // R must NOT count
      emo('emotionDuring', ['calm'], 'win', '1.0', 'computed'),
    ];
    const [row] = perEmotionField(trades, 'emotionDuring');
    expect(row).toEqual({ slug: 'calm', trades: 2, wins: 2, sumR: 1, rTrades: 1 });
  });

  it('skips a non-finite realizedR string without dropping the trade/win count', () => {
    const trades = [emo('emotionAfter', ['euphoric'], 'win', 'NaN', 'computed')];
    expect(perEmotionField(trades, 'emotionAfter')).toEqual([
      { slug: 'euphoric', trades: 1, wins: 1, sumR: 0, rTrades: 0 },
    ]);
  });
});

// =============================================================================
// localHourOf — Paris-wall-clock hour extraction (DST-correct via Intl)
// =============================================================================
describe('localHourOf', () => {
  it('uses Paris wall clock, not the UTC hour (CEST = UTC+2 in summer)', () => {
    // 2026-06-15T08:00Z → 10:00 Paris.
    expect(localHourOf('2026-06-15T08:00:00Z', PARIS)).toBe(10);
  });

  it('crosses the civil-day boundary correctly (23:15Z → 01:00 next day Paris)', () => {
    // 2026-06-15T23:15Z is 2026-06-16 01:15 Paris.
    expect(localHourOf('2026-06-15T23:15:00Z', PARIS)).toBe(1);
  });

  it('honours winter offset (CET = UTC+1)', () => {
    // 2026-01-15T08:00Z → 09:00 Paris (winter).
    expect(localHourOf('2026-01-15T08:00:00Z', PARIS)).toBe(9);
  });

  it('returns null on an unparseable instant', () => {
    expect(localHourOf('not-a-date', PARIS)).toBeNull();
  });

  it('falls back to UTC on an unknown timezone (never throws)', () => {
    expect(localHourOf('2026-06-15T08:00:00Z', 'Mars/Olympus')).toBe(8);
  });
});

// =============================================================================
// perHour — 4 entry-time bands (Nuit / Matin / Après-midi / Soir), TZ Paris
// =============================================================================
describe('perHour', () => {
  it('always returns the 4 bands in a stable earliest-first order, even when empty', () => {
    const rows = perHour([], PARIS);
    expect(rows.map((r) => r.slot)).toEqual<HourSlot[]>([
      'night',
      'morning',
      'afternoon',
      'evening',
    ]);
    // An empty window yields zeroed metrics — never a fabricated win-rate.
    expect(rows.every((r) => r.trades === 0 && r.winRate === 0 && r.avgR === 0)).toBe(true);
  });

  it('buckets by Paris entry hour, not the UTC hour', () => {
    // 05:00Z → 07:00 Paris (Matin), NOT Nuit. A UTC slice would mis-bucket.
    const rows = perHour([hourTrade('2026-06-15T05:00:00Z', 'win', '1.0')], PARIS);
    const bySlot = Object.fromEntries(rows.map((r) => [r.slot, r]));
    expect(bySlot.morning!.trades).toBe(1);
    expect(bySlot.night!.trades).toBe(0);
  });

  it('computes win-rate and avg R per band (golden values)', () => {
    // 4 Matin trades (09:00 Paris = 07:00Z): 3 wins / 1 loss, R = 2,1,3,-1.
    const trades = [
      hourTrade('2026-06-15T07:00:00Z', 'win', '2.0'),
      hourTrade('2026-06-15T07:00:00Z', 'win', '1.0'),
      hourTrade('2026-06-15T07:00:00Z', 'win', '3.0'),
      hourTrade('2026-06-15T07:00:00Z', 'loss', '-1.0'),
    ];
    const morning = perHour(trades, PARIS).find((r) => r.slot === 'morning')!;
    expect(morning.trades).toBe(4);
    expect(morning.winRate).toBeCloseTo(0.75, 12); // 3/4
    expect(morning.avgR).toBeCloseTo(1.25, 12); // (2+1+3-1)/4
  });

  it('EXCLUDES estimated-source R from avg R but counts the trade + win', () => {
    // Soir band (20:00 Paris = 18:00Z): one estimated win, one computed win.
    const trades = [
      hourTrade('2026-06-15T18:00:00Z', 'win', '5.0', 'estimated'), // R excluded
      hourTrade('2026-06-15T18:00:00Z', 'win', '1.0', 'computed'),
    ];
    const evening = perHour(trades, PARIS).find((r) => r.slot === 'evening')!;
    expect(evening.trades).toBe(2);
    expect(evening.winRate).toBe(1); // both wins counted
    expect(evening.avgR).toBeCloseTo(1, 12); // only the computed 1.0 averaged
  });

  it('skips a null enteredAt and an unparseable enteredAt (no phantom band)', () => {
    const trades = [
      hourTrade(null, 'win', '1.0'),
      hourTrade('garbage', 'win', '1.0'),
      hourTrade('2026-06-15T01:00:00Z', 'loss', '-1.0'), // 03:00 Paris = Nuit
    ];
    const rows = perHour(trades, PARIS);
    const total = rows.reduce((s, r) => s + r.trades, 0);
    expect(total).toBe(1);
    expect(rows.find((r) => r.slot === 'night')!.trades).toBe(1);
  });

  it('places a winter-offset late-night trade in the correct Paris band', () => {
    // 2026-01-15T23:30Z + CET(+1) = 00:30 next day Paris → Nuit (0–6 h).
    const rows = perHour([hourTrade('2026-01-15T23:30:00Z', 'win', '1.0')], PARIS);
    expect(rows.find((r) => r.slot === 'night')!.trades).toBe(1);
  });

  it('exposes a non-fabrication threshold for the surface to flag thin bands', () => {
    expect(HOURLY_MIN_SAMPLE).toBe(5);
  });
});

// =============================================================================
// emotionArcDegradation (S15 #5) — entered serene → lost composure
// =============================================================================

type ArcTrade = {
  emotionBefore: readonly string[] | null;
  emotionDuring: readonly string[] | null;
  emotionAfter: readonly string[] | null;
};

function arc(
  before: readonly string[] | null,
  during: readonly string[] | null,
  after: readonly string[] | null,
): ArcTrade {
  return { emotionBefore: before, emotionDuring: during, emotionAfter: after };
}

describe('emotionArcDegradation', () => {
  it('counts a serene→negative trade and records the transition example', () => {
    const res = emotionArcDegradation([arc(['calm'], [], ['frustrated'])]);
    expect(res.count).toBe(1);
    expect(res.considered).toBe(1);
    expect(res.examples).toEqual([{ from: 'calm', to: 'frustrated' }]);
  });

  it('detects the negative tag on emotionDuring as well as emotionAfter', () => {
    const res = emotionArcDegradation([arc(['confident'], ['revenge-trade'], ['calm'])]);
    expect(res.count).toBe(1);
    expect(res.examples[0]).toEqual({ from: 'confident', to: 'revenge-trade' });
  });

  it('does NOT count a trade that stayed serene throughout', () => {
    const res = emotionArcDegradation([arc(['calm'], ['confident'], ['calm'])]);
    expect(res.count).toBe(0);
    expect(res.considered).toBe(1); // entered serene, just didn't degrade
  });

  it('ignores trades that entered already-negative (not "entered calm")', () => {
    const res = emotionArcDegradation([arc(['calm', 'anxious'], [], ['frustrated'])]);
    expect(res.count).toBe(0);
    expect(res.considered).toBe(0); // mixed entry → not a serene entry
  });

  it('ignores trades with no entry emotion', () => {
    const res = emotionArcDegradation([arc(null, ['frustrated'], ['frustrated'])]);
    expect(res.count).toBe(0);
    expect(res.considered).toBe(0);
  });

  it('treats euphoric as a negative (loss-of-discipline) exit but bored as neutral', () => {
    const euphoric = emotionArcDegradation([arc(['calm'], [], ['euphoric'])]);
    expect(euphoric.count).toBe(1);
    const bored = emotionArcDegradation([arc(['calm'], [], ['bored'])]);
    expect(bored.count).toBe(0);
  });

  it('caps examples at 3 while counting all degraded trades', () => {
    const trades = Array.from({ length: 5 }, () => arc(['calm'], [], ['frustrated']));
    const res = emotionArcDegradation(trades);
    expect(res.count).toBe(5);
    expect(res.examples).toHaveLength(3);
  });

  it('exposes a calm surfacing threshold', () => {
    expect(EMOTION_ARC_MIN_TO_SURFACE).toBe(3);
  });
});
