import { describe, expect, it } from 'vitest';

import {
  TRADE_TAG_SLUGS,
  TRADE_TAGS_MAX_PER_TRADE,
  isTradeTagSlug,
  tradeCloseSchema,
  tradeFullSchema,
  tradeOpenSchema,
  tradeTagSchema,
  tradeTagsSchema,
  WIZARD_STEPS,
} from './trade';

const VALID_KEY = 'trades/clx0abc1234/abcdef0123456789abcdef0123456789.jpg';

const baseOpen = {
  pair: 'EURUSD',
  direction: 'long' as const,
  session: 'london' as const,
  enteredAt: new Date('2026-05-05T08:00:00Z'),
  entryPrice: 1.1,
  lotSize: 0.5,
  stopLossPrice: 1.095,
  plannedRR: 2,
  emotionBefore: ['calm'],
  planRespected: true,
  hedgeRespected: 'na' as const,
  notes: 'Setup propre.',
  screenshotEntryKey: VALID_KEY,
};

describe('tradeOpenSchema', () => {
  it('accepts a valid pre-entry submission', () => {
    const result = tradeOpenSchema.safeParse(baseOpen);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hedgeRespected).toBeNull();
    }
  });

  it('uppercases and trims the pair', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, pair: ' eurusd ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pair).toBe('EURUSD');
  });

  it('rejects pairs outside the allowlist', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, pair: 'BTCUSD' });
    expect(result.success).toBe(false);
  });

  it.each(['true', 'false', 'na'])('coerces hedgeRespected = %s correctly', (v) => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, hedgeRespected: v });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hedgeRespected).toBe(v === 'na' ? null : v === 'true');
    }
  });

  it('rejects more than EMOTION_MAX_PER_MOMENT tags', () => {
    const result = tradeOpenSchema.safeParse({
      ...baseOpen,
      emotionBefore: ['calm', 'confident', 'doubt', 'anxious'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown emotion slugs', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, emotionBefore: ['serenity'] });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate emotion tags', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, emotionBefore: ['calm', 'calm'] });
    expect(result.success).toBe(false);
  });

  it('rejects an entry timestamp far in the future', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const result = tradeOpenSchema.safeParse({ ...baseOpen, enteredAt: farFuture });
    expect(result.success).toBe(false);
  });

  it('rejects negative prices', () => {
    expect(tradeOpenSchema.safeParse({ ...baseOpen, entryPrice: -1 }).success).toBe(false);
    expect(tradeOpenSchema.safeParse({ ...baseOpen, lotSize: 0 }).success).toBe(false);
  });

  it('warns when stopLoss is on the wrong side for a long', () => {
    const result = tradeOpenSchema.safeParse({
      ...baseOpen,
      direction: 'long',
      entryPrice: 1.1,
      stopLossPrice: 1.105, // above entry → invalid for long
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'stopLossPrice')).toBe(true);
    }
  });

  it('warns when stopLoss is on the wrong side for a short', () => {
    const result = tradeOpenSchema.safeParse({
      ...baseOpen,
      direction: 'short',
      entryPrice: 1.1,
      stopLossPrice: 1.095, // below entry → invalid for short
    });
    expect(result.success).toBe(false);
  });

  it('accepts a missing stopLoss (estimated R fallback path)', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, stopLossPrice: null });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed screenshot key', () => {
    const result = tradeOpenSchema.safeParse({
      ...baseOpen,
      screenshotEntryKey: '/etc/passwd',
    });
    expect(result.success).toBe(false);
  });
});

describe('tradeCloseSchema', () => {
  const baseClose = {
    exitedAt: new Date('2026-05-05T11:00:00Z'),
    exitPrice: 1.105,
    outcome: 'win' as const,
    emotionAfter: ['confident'],
    notes: 'TP atteint, discipline OK.',
    screenshotExitKey: 'trades/clx0abc1234/fedcba9876543210fedcba9876543210.png',
  };

  it('accepts a valid close', () => {
    expect(tradeCloseSchema.safeParse(baseClose).success).toBe(true);
  });

  it('requires a screenshot', () => {
    const { screenshotExitKey, ...rest } = baseClose;
    void screenshotExitKey;
    expect(tradeCloseSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects exit at a far-future date', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(tradeCloseSchema.safeParse({ ...baseClose, exitedAt: farFuture }).success).toBe(false);
  });
});

describe('tradeFullSchema cross-validation', () => {
  it('rejects when exit is before entry', () => {
    const result = tradeFullSchema.safeParse({
      open: baseOpen,
      close: {
        exitedAt: new Date('2026-05-05T07:00:00Z'),
        exitPrice: 1.105,
        outcome: 'win',
        emotionAfter: ['confident'],
        screenshotExitKey: 'trades/clx0abc1234/fedcba9876543210fedcba9876543210.png',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an open-only submission (close omitted)', () => {
    const result = tradeFullSchema.safeParse({ open: baseOpen });
    expect(result.success).toBe(true);
  });
});

describe('WIZARD_STEPS', () => {
  it('lists 7 steps covering pre-entry through post-exit', () => {
    expect(WIZARD_STEPS).toHaveLength(7);
  });

  it('first step covers pair + enteredAt', () => {
    expect(WIZARD_STEPS[0]).toEqual(expect.arrayContaining(['pair', 'enteredAt']));
  });
});

// =============================================================================
// V1.5 — Trade quality + risk %
// =============================================================================

describe('tradeOpenSchema — V1.5 tradeQuality', () => {
  it('accepts A / B / C', () => {
    for (const q of ['A', 'B', 'C'] as const) {
      const result = tradeOpenSchema.safeParse({ ...baseOpen, tradeQuality: q });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tradeQuality).toBe(q);
      }
    }
  });

  it('rejects values outside the A/B/C enum', () => {
    for (const q of ['D', 'a', 'AA', '', 1]) {
      const result = tradeOpenSchema.safeParse({ ...baseOpen, tradeQuality: q });
      expect(result.success).toBe(false);
    }
  });

  it('treats omission as undefined (V1 trades pre-V1.5 stay valid)', () => {
    const result = tradeOpenSchema.safeParse(baseOpen);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tradeQuality).toBeUndefined();
    }
  });
});

// =============================================================================
// V1.8 — Trade.tags (CFA LESSOR + Steenbarger)
// =============================================================================

describe('tradeTagsSchema (V1.8)', () => {
  it('accepts up to TRADE_TAGS_MAX_PER_TRADE valid slugs', () => {
    const sample = ['loss-aversion', 'revenge-trade', 'overconfidence'];
    const result = tradeTagsSchema.safeParse(sample);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(sample);
  });

  it('rejects an unknown slug', () => {
    const result = tradeTagsSchema.safeParse(['loss-aversion', 'fomo']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /inconnu/i.test(i.message))).toBe(true);
    }
  });

  it('rejects duplicates', () => {
    const result = tradeTagsSchema.safeParse(['loss-aversion', 'loss-aversion']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /[Dd]oublon/.test(i.message))).toBe(true);
    }
  });

  it(`rejects more than ${TRADE_TAGS_MAX_PER_TRADE} tags`, () => {
    const result = tradeTagsSchema.safeParse([
      'loss-aversion',
      'overconfidence',
      'regret-aversion',
      'status-quo',
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts an empty array (member did not classify)', () => {
    const result = tradeTagsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('exposes exactly 8 LESSOR + Steenbarger slugs', () => {
    // Anti-regression — if a future PR adds an "informal" slug without an
    // ADR, this test catches it.
    expect(TRADE_TAG_SLUGS).toHaveLength(8);
    expect(TRADE_TAG_SLUGS).toContain('loss-aversion');
    expect(TRADE_TAG_SLUGS).toContain('discipline-high');
    expect(TRADE_TAG_SLUGS).not.toContain('fomo');
    expect(TRADE_TAG_SLUGS).not.toContain('tilt');
  });

  it('tradeTagSchema single-slug parser matches isTradeTagSlug guard', () => {
    for (const slug of TRADE_TAG_SLUGS) {
      expect(tradeTagSchema.safeParse(slug).success).toBe(true);
      expect(isTradeTagSlug(slug)).toBe(true);
    }
    expect(tradeTagSchema.safeParse('not-a-tag').success).toBe(false);
    expect(isTradeTagSlug('not-a-tag')).toBe(false);
  });
});

describe('tradeCloseSchema — V1.8 tags integration', () => {
  const baseClose = {
    exitedAt: new Date('2026-05-05T11:00:00Z'),
    exitPrice: 1.105,
    outcome: 'win' as const,
    emotionAfter: ['confident'],
    notes: 'TP atteint, discipline OK.',
    screenshotExitKey: 'trades/clx0abc1234/fedcba9876543210fedcba9876543210.png',
  };

  it('defaults `tags` to an empty array when omitted', () => {
    const result = tradeCloseSchema.safeParse(baseClose);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual([]);
  });

  it('accepts a close payload carrying valid tags', () => {
    const result = tradeCloseSchema.safeParse({
      ...baseClose,
      tags: ['discipline-high'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual(['discipline-high']);
  });

  it('rejects a close payload with an unknown tag slug', () => {
    const result = tradeCloseSchema.safeParse({
      ...baseClose,
      tags: ['invented-slug'],
    });
    expect(result.success).toBe(false);
  });
});

describe('tradeOpenSchema — V1.5 riskPct', () => {
  it('accepts 0 < riskPct < 100', () => {
    for (const v of [0.01, 0.5, 1.5, 50, 99.99]) {
      const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: v });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.riskPct).toBeCloseTo(v, 2);
      }
    }
  });

  it('rejects 0 (use NULL/omission for "not captured" — security-auditor M3)', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative riskPct', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects riskPct ≥ 100 (degenerate full-account exposure)', () => {
    expect(tradeOpenSchema.safeParse({ ...baseOpen, riskPct: 100 }).success).toBe(false);
    expect(tradeOpenSchema.safeParse({ ...baseOpen, riskPct: 150 }).success).toBe(false);
  });

  it('coerces riskPct from a numeric string (form data)', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: '1.5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.riskPct).toBe(1.5);
    }
  });

  it('accepts FR locale decimal comma "1,5" → 1.5 (audit L2)', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: '1,5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.riskPct).toBe(1.5);
    }
  });

  it('rejects multiple commas (locale ambiguity)', () => {
    const result = tradeOpenSchema.safeParse({ ...baseOpen, riskPct: '1,5,0' });
    expect(result.success).toBe(false);
  });

  it('treats omission as undefined (default = NULL in DB)', () => {
    const result = tradeOpenSchema.safeParse(baseOpen);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.riskPct).toBeUndefined();
    }
  });
});
