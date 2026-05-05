import { describe, expect, it } from 'vitest';

import { tradeOpenSchema, tradeCloseSchema, tradeFullSchema, WIZARD_STEPS } from './trade';

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
