import { describe, expect, it } from 'vitest';

import { PRE_TRADE_EMOTIONS, PRE_TRADE_REASONS, preTradeCheckSchema } from './pre-trade-check';

describe('PRE_TRADE_REASONS / PRE_TRADE_EMOTIONS tuples (anti-regression)', () => {
  it('PRE_TRADE_REASONS has exactly 4 canonical values', () => {
    expect(PRE_TRADE_REASONS).toHaveLength(4);
    expect(PRE_TRADE_REASONS).toEqual(['edge', 'fomo', 'revenge', 'boredom']);
  });

  it('PRE_TRADE_EMOTIONS has exactly 4 canonical values (Russell 1989 2×2)', () => {
    expect(PRE_TRADE_EMOTIONS).toHaveLength(4);
    expect(PRE_TRADE_EMOTIONS).toEqual(['calme', 'excite', 'frustre', 'anxieux']);
  });
});

describe('preTradeCheckSchema — happy path (4 valid combinations)', () => {
  it('accepts the canonical "edge + calme + plan + stop" minimal-friction case', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasonToTrade).toBe('edge');
      expect(result.data.emotionLabel).toBe('calme');
      expect(result.data.planAlignment).toBe(true);
      expect(result.data.stopLossPredefined).toBe(true);
    }
  });

  it('accepts the "fomo + excite + no plan + no stop" worst-case fear payload', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'fomo',
      emotionLabel: 'excite',
      planAlignment: false,
      stopLossPredefined: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the "revenge + frustre" Mark Douglas tilt-recovery payload', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'revenge',
      emotionLabel: 'frustre',
      planAlignment: false,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the "boredom + anxieux" Steenbarger low-arousal payload', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'boredom',
      emotionLabel: 'anxieux',
      planAlignment: true,
      stopLossPredefined: false,
    });
    expect(result.success).toBe(true);
  });
});

describe('preTradeCheckSchema — enum reject paths', () => {
  it('rejects unknown reasonToTrade (e.g. "yolo" outside Douglas + Steenbarger)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'yolo',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('reasonToTrade'));
      expect(issue).toBeDefined();
    }
  });

  it('rejects unknown emotionLabel (e.g. "neutre" outside Russell 2×2)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'neutre',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('emotionLabel'));
      expect(issue).toBeDefined();
    }
  });

  it('rejects English aliases of FR labels (defense against UI drift)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calm', // English alias of "calme" — must be rejected
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('preTradeCheckSchema — boolean strictness', () => {
  it('rejects truthy strings for planAlignment (e.g. "true")', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: 'true', // string, not boolean — Server Action must coerce
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('planAlignment'));
      expect(issue).toBeDefined();
    }
  });

  it('rejects falsy strings for stopLossPredefined (e.g. "false")', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: 'false', // J5 footgun pattern: Boolean('false') === true
    });
    expect(result.success).toBe(false);
  });

  it('rejects numeric 0/1 for booleans (no implicit coercion)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: 1,
      stopLossPredefined: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('preTradeCheckSchema — .strict() rejects unknown keys', () => {
  it('rejects an extra field "notes" (defense against UI/LLM bug adding free-text)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
      notes: 'Long thread spread across positions', // not in the schema
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue).toBeDefined();
    }
  });

  it('rejects an extra field "linkedTradeId" (server-only, never from the client)', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
      linkedTradeId: 'cuid-fake', // service-layer-only field, must not arrive from client
    });
    expect(result.success).toBe(false);
  });
});

describe('preTradeCheckSchema — missing-field reject', () => {
  it('rejects missing reasonToTrade', () => {
    const result = preTradeCheckSchema.safeParse({
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing emotionLabel', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing planAlignment', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      stopLossPredefined: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing stopLossPredefined', () => {
    const result = preTradeCheckSchema.safeParse({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
    });
    expect(result.success).toBe(false);
  });
});
