import { describe, expect, it } from 'vitest';

import {
  computeEmotionalStabilityScore,
  type EmotionalStabilityCheckinInput,
  type EmotionalStabilityTradeInput,
} from './emotional-stability';

const C = (
  date: string,
  moodScore: number | null,
  stressScore: number | null = null,
  tags: string[] = [],
  slot: 'morning' | 'evening' = 'evening',
): EmotionalStabilityCheckinInput => ({
  slot,
  date,
  moodScore,
  stressScore,
  emotionTags: tags,
});

/** Closed-trade fixture. Emotion arrays default empty → trade carries no
 *  emotion data → excluded from the DoD#3 footprint (byte-identical default). */
const TR = (
  closeDay: string | null,
  outcome: EmotionalStabilityTradeInput['outcome'],
  emo: {
    before?: string[];
    during?: string[];
    after?: string[];
  } = {},
): EmotionalStabilityTradeInput => ({
  closeDay,
  outcome,
  emotionBefore: emo.before ?? [],
  emotionDuring: emo.during ?? [],
  emotionAfter: emo.after ?? [],
});

const days14 = (start = 1): string[] =>
  Array.from({ length: 14 }, (_, i) => `2026-01-${String(start + i).padStart(2, '0')}`);

describe('computeEmotionalStabilityScore', () => {
  it('returns no_checkins when no mood data', () => {
    const r = computeEmotionalStabilityScore({ checkins: [], closedTrades: [] });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
  });

  it('returns window_short when fewer than 14 mood-days', () => {
    const checkins = days14()
      .slice(0, 10)
      .map((d) => C(d, 7));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
    expect(r.sample.days).toBe(10);
  });

  it('returns ok when ≥14 mood-days', () => {
    const checkins = days14().map((d) => C(d, 7));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.status).toBe('ok');
    expect(r.score).not.toBeNull();
  });

  it('counts DISTINCT local days, not slots — 7 days × (morning+evening) is NOT enough', () => {
    // 7 calendar days, each filled BOTH morning AND evening = 14 mood SLOTS but
    // only 7 distinct days. The gate must read 7 (window_short), never 14: the
    // sample-size confidence is in days, not slots (§7.11).
    const days7 = days14().slice(0, 7);
    const checkins = days7.flatMap((d) => [C(d, 7, 5, [], 'morning'), C(d, 6, 5, [], 'evening')]);
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
    expect(r.sample.days).toBe(7);
  });

  it('rewards perfectly stable mood (stdDev=0) with full moodVariance points', () => {
    const checkins = days14().map((d) => C(d, 6, 1, [])); // stable mood, low stress, no tags
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    // moodVar=40 (stddev=0 → 1×40), stress=25 (median=1 → 1×25), no tagged days → skip
    // active weights: 40 + 25 = 65, awarded 65 → 100.
    expect(r.score).toBe(100);
    expect(r.parts.moodVariance.pointsAwarded).toBe(40);
  });

  it('penalizes high mood variance', () => {
    const moods = [1, 10, 1, 10, 1, 10, 1, 10, 1, 10, 1, 10, 1, 10];
    const checkins = days14().map((d, i) => C(d, moods[i]!, 1, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    // stddev ≈ 4.68 → moodVarValue = max(0, 1 - 4.68/8) ≈ 0.415
    expect(r.parts.moodVariance.rate).toBeLessThan(0.5);
  });

  it('penalizes high stress median', () => {
    // mood stable at 5, evening stress always 10 → stressVal = 0
    const checkins = days14().map((d) => C(d, 5, 10, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.parts.stressMedian.rate).toBe(0);
  });

  it('penalizes high negative-emotion rate', () => {
    const checkins = days14().map((d) => C(d, 5, 5, ['fomo'])); // every day has a negative tag
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.parts.negativeEmotionRate.rate).toBe(0);
    expect(r.parts.negativeEmotionRate.numerator).toBe(14);
    expect(r.parts.negativeEmotionRate.denominator).toBe(14);
  });

  it('handles a mix of positive and negative emotion tags', () => {
    const ds = days14();
    const checkins = ds.map((d, i) => C(d, 5, 5, i % 2 === 0 ? ['calm'] : ['fomo']));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    // 7 negative / 14 tagged = 0.5 → negValue = 0.5
    expect(r.parts.negativeEmotionRate.rate).toBe(0.5);
  });

  it('skips negativeEmotionRate sub-score entirely when no tags exist (renormalize)', () => {
    const checkins = days14().map((d) => C(d, 5, 1, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    // moodVar=40 (stddev=0), stress=25 (median=1), no neg-emo, no recovery
    // active = 65, awarded = 65 → 100
    expect(r.score).toBe(100);
  });

  it('computes recoveryAfterLoss when there is a day-after data point', () => {
    // Loss on day 1, baseline mood ~5, day 2 mood = 8 (recovers)
    const moods: Record<string, number> = {
      '2026-01-01': 5,
      '2026-01-02': 8,
      '2026-01-03': 5,
      '2026-01-04': 5,
      '2026-01-05': 5,
      '2026-01-06': 5,
      '2026-01-07': 5,
      '2026-01-08': 5,
      '2026-01-09': 5,
      '2026-01-10': 5,
      '2026-01-11': 5,
      '2026-01-12': 5,
      '2026-01-13': 5,
      '2026-01-14': 5,
    };
    const checkins = Object.entries(moods).map(([d, m]) => C(d, m, 1, []));
    const trades: EmotionalStabilityTradeInput[] = [TR('2026-01-01', 'loss')];
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    expect(r.parts.recoveryAfterLoss).not.toBeNull();
    expect(r.parts.recoveryAfterLoss!.rate).toBeGreaterThan(0.5); // bounced back
  });

  it('skips recoveryAfterLoss when no loss days exist (renormalize)', () => {
    const checkins = days14().map((d) => C(d, 5, 1, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.parts.recoveryAfterLoss).toBeNull();
  });

  it('renormalizes the dimension when recovery is null', () => {
    // Stable mood, low stress, no tags, no loss → score should still hit 100.
    const checkins = days14().map((d) => C(d, 6, 1, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.score).toBe(100);
  });

  it('exposes parts even on insufficient_data branch (UI transparency)', () => {
    const checkins = days14()
      .slice(0, 5)
      .map((d) => C(d, 7, 5, []));
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    expect(r.score).toBeNull();
    expect(r.parts.moodVariance.pointsAwarded).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DoD#3 — trade-emotion footprint sub-score.
//
// ADDITION PURE: `WEIGHT_TRADE_EMO` (15) is added EN PLUS; the existing four
// weights (40/25/20/15) are NEVER rebalanced. A member whose closed trades
// carry NO emotion data scores BYTE-IDENTICALLY to pre-DoD#3 — the part is
// `null` and renormalized away.
//
// EXACT mirror of `negativeEmotionRate` (checkin tags), reusing the SAME
// NEGATIVE_EMOTION_SLUGS set: denominator = closed trades with ≥1 non-empty
// before/during/after array; numerator = those whose arrays contain a negative
// slug; sub-score = clamp(1 − rate) (higher = calmer trading). SPEC §2: reads
// the emotional ARC, never the trade's P&L / outcome.
// ---------------------------------------------------------------------------

describe('computeEmotionalStabilityScore — trade-emotion footprint (DoD#3)', () => {
  // 14 stable-mood, low-stress, no-checkin-tag days → the three checkin
  // sub-scores are fully determined (moodVar 40 @ rate1, stress 25 @ rate1,
  // negEmo skipped, recovery skipped) so any delta is attributable to the
  // trade footprint alone. Base (no trade emotion) score = 100.
  const stableCheckins = (): EmotionalStabilityCheckinInput[] =>
    days14().map((d) => C(d, 6, 1, []));

  it('ZERO REGRESSION — no trade carries emotion data ≡ pre-DoD#3 (byte-identical, part null)', () => {
    const checkins = stableCheckins();
    // Closed trades present but with empty emotion arrays (every pre-DoD#3 row).
    // `closeDay: null` keeps recovery-after-loss skipped so the ONLY variable
    // under test is the footprint — isolating the byte-identical proof.
    const trades = [TR(null, 'win'), TR(null, 'loss')];
    const base = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    const withTrades = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    expect(base.score).toBe(100); // pinned pre-DoD#3 value
    expect(withTrades.score).toBe(base.score);
    expect(base.parts.tradeEmotionFootprint).toBeNull();
    expect(withTrades.parts.tradeEmotionFootprint).toBeNull();
  });

  it('all-calm trades → full WEIGHT_TRADE_EMO contribution (still 100 when otherwise perfect)', () => {
    const checkins = stableCheckins();
    // 4 trades, each carrying a non-negative slug only → rate 0 negative → 1−0=1.
    // `closeDay: null` → recovery stays skipped (footprint isolated).
    const trades = [
      TR(null, 'win', { before: ['calm'] }),
      TR(null, 'loss', { during: ['confident'] }),
      TR(null, 'win', { after: ['calm'] }),
      TR(null, 'break_even', { before: ['confident'], after: ['calm'] }),
    ];
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    expect(r.score).toBe(100);
    expect(r.parts.tradeEmotionFootprint).not.toBeNull();
    expect(r.parts.tradeEmotionFootprint?.rate).toBe(1);
    expect(r.parts.tradeEmotionFootprint?.pointsMax).toBe(15);
    expect(r.parts.tradeEmotionFootprint?.pointsAwarded).toBe(15);
    expect(r.parts.tradeEmotionFootprint?.numerator).toBe(0); // 0 negative trades
    expect(r.parts.tradeEmotionFootprint?.denominator).toBe(4);
  });

  it('all-negative trades → rate 0 (calmest=0), sub-score present, dimension drops', () => {
    const checkins = stableCheckins();
    // Every trade carries ≥1 negative slug across before/during/after.
    // `closeDay: null` → recovery skipped → active max = moodVar 40 + stress 25
    // + footprint 15 = 80 (no recovery 15), isolating the footprint.
    const trades = [
      TR(null, 'loss', { before: ['fomo'] }),
      TR(null, 'loss', { during: ['fear-loss'] }),
      TR(null, 'win', { after: ['frustrated'] }),
      TR(null, 'loss', { before: ['anxious'], after: ['doubt'] }),
    ];
    const base = computeEmotionalStabilityScore({ checkins, closedTrades: [] });
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    // base 100 over active max 65; with footprint at rate 0: awarded 65, active
    // max 80 → 65/80 × 100 = 81.25 → 81. Strictly below base.
    expect(r.score).toBe(81);
    expect(r.score!).toBeLessThan(base.score!);
    expect(r.parts.tradeEmotionFootprint?.rate).toBe(0);
    expect(r.parts.tradeEmotionFootprint?.numerator).toBe(4);
    expect(r.parts.tradeEmotionFootprint?.denominator).toBe(4);
    expect(r.parts.tradeEmotionFootprint?.pointsAwarded).toBe(0);
  });

  it('mixed: trades with empty arrays are excluded from the denominator', () => {
    const checkins = stableCheckins();
    // 2 trades carry emotion (1 negative), 2 trades carry NO emotion (excluded).
    const trades = [
      TR(null, 'loss', { before: ['fomo'] }), // negative
      TR(null, 'win', { after: ['calm'] }), // positive
      TR(null, 'win'), // empty → excluded
      TR(null, 'loss'), // empty → excluded
    ];
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    // 1 negative / 2 with-emotion = 0.5 → 1−0.5 = 0.5.
    expect(r.parts.tradeEmotionFootprint?.rate).toBe(0.5);
    expect(r.parts.tradeEmotionFootprint?.numerator).toBe(1);
    expect(r.parts.tradeEmotionFootprint?.denominator).toBe(2);
  });

  it('a single negative slug ANYWHERE in the 3 arrays marks the trade negative', () => {
    const checkins = stableCheckins();
    // calm before + confident after, but ONE negative during → counts negative.
    const trades = [
      TR(null, 'win', { before: ['calm'], during: ['fear-wrong'], after: ['confident'] }),
    ];
    const r = computeEmotionalStabilityScore({ checkins, closedTrades: trades });
    expect(r.parts.tradeEmotionFootprint?.numerator).toBe(1);
    expect(r.parts.tradeEmotionFootprint?.denominator).toBe(1);
    expect(r.parts.tradeEmotionFootprint?.rate).toBe(0);
  });
});
