import { describe, expect, it } from 'vitest';

import { TRADE_TAG_SLUGS } from '@/lib/schemas/trade';

import { isPositiveTradeTag, TRADE_TAG_LABELS } from './reflect-tags';

describe('TRADE_TAG_LABELS', () => {
  it('covers every slug of the Zod allowlist with a non-empty FR label', () => {
    for (const slug of TRADE_TAG_SLUGS) {
      expect(TRADE_TAG_LABELS[slug]).toBeTruthy();
      expect(TRADE_TAG_LABELS[slug].length).toBeGreaterThan(2);
    }
  });

  it('has no extra key outside the allowlist', () => {
    expect(Object.keys(TRADE_TAG_LABELS).sort()).toEqual([...TRADE_TAG_SLUGS].sort());
  });

  it('uses simple punctuation (never an em-dash) in member-facing labels', () => {
    for (const label of Object.values(TRADE_TAG_LABELS)) {
      expect(label).not.toContain('—');
    }
  });
});

describe('isPositiveTradeTag', () => {
  it('flags only discipline-high as strengths-based', () => {
    expect(isPositiveTradeTag('discipline-high')).toBe(true);
    expect(isPositiveTradeTag('revenge-trade')).toBe(false);
    expect(isPositiveTradeTag('loss-aversion')).toBe(false);
  });
});
