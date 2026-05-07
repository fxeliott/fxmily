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
    const trades: EmotionalStabilityTradeInput[] = [{ closeDay: '2026-01-01', outcome: 'loss' }];
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
