import { describe, expect, it } from 'vitest';

import { annotationCreateSchema, ANNOTATION_COMMENT_MAX } from '@/lib/schemas/annotation';

import {
  ALL_COMMENT_PRESETS,
  COMMENT_PRESET_GROUPS,
  type CommentPresetGroupId,
} from './comment-presets';

/**
 * S7 §33-#1 — guardrail tests for the admin comment palette.
 *
 * The palette ships pre-written reframes that the admin drops into a trade /
 * backtest correction. Two non-negotiables:
 *   1. GARDE-FOU §2 — every phrase is STRICTLY psychological / discipline /
 *      execution-respect. NONE may carry trade-analysis advice (direction,
 *      price level, indicator, trend / setup validity). A forbidden-token scan
 *      makes a future edit that smuggles analysis in fail CI rather than reach
 *      a member.
 *   2. Each phrase must be a VALID submittable comment (passes the same Zod
 *      schema the Server Action enforces), so a one-tap insert can never be
 *      rejected at submit time.
 */

const EXPECTED_GROUP_IDS: readonly CommentPresetGroupId[] = [
  'plan',
  'process',
  'emotion',
  'ego',
  'routine',
  'patience',
];

/** Whole-word tokens that signal trade-analysis advice (never allowed). */
const FORBIDDEN_WORDS: readonly string[] = [
  // direction / call
  'achète',
  'achete',
  'acheter',
  'achat',
  'vends',
  'vendre',
  'vente',
  'long',
  'short',
  'haussier',
  'baissier',
  'haussière',
  'baissière',
  'bullish',
  'bearish',
  // levels / indicators
  'résistance',
  'resistance',
  'support',
  'fibonacci',
  'rsi',
  'macd',
  'ema',
  'sma',
  // setup / prediction
  'cassure',
  'breakout',
  'pullback',
  'prévision',
  'prevision',
];

/** Multi-word phrases that signal trade-analysis advice (never allowed). */
const FORBIDDEN_PHRASES: readonly string[] = [
  'va monter',
  'va descendre',
  'ça monte',
  'ça descend',
  'objectif de prix',
  'niveau de prix',
  'prix cible',
  'price target',
  'moyenne mobile',
  'setup valide',
  'setup valable',
  'bon setup',
];

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zàâäçéèêëîïôöùûüÿœæ]+/i)
    .filter(Boolean);
}

describe('comment-presets — structure', () => {
  it('exposes exactly the six declared groups, in order', () => {
    expect(COMMENT_PRESET_GROUPS.map((g) => g.id)).toEqual(EXPECTED_GROUP_IDS);
  });

  it('gives every group a non-empty label and at least one preset', () => {
    for (const group of COMMENT_PRESET_GROUPS) {
      expect(group.label.trim().length).toBeGreaterThan(0);
      expect(group.presets.length).toBeGreaterThan(0);
    }
  });

  it('flattens to a meaningful, fully-unique set of presets', () => {
    const total = COMMENT_PRESET_GROUPS.reduce((n, g) => n + g.presets.length, 0);
    expect(ALL_COMMENT_PRESETS).toHaveLength(total);
    expect(ALL_COMMENT_PRESETS.length).toBeGreaterThanOrEqual(10);

    const ids = ALL_COMMENT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const labels = ALL_COMMENT_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('comment-presets — each preset is a submittable comment', () => {
  it.each(ALL_COMMENT_PRESETS.map((p) => [p.id, p.text] as const))(
    '%s passes the annotation Zod schema',
    (_id, text) => {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(ANNOTATION_COMMENT_MAX);
      const parsed = annotationCreateSchema.safeParse({ comment: text });
      expect(parsed.success).toBe(true);
    },
  );
});

describe('comment-presets — GARDE-FOU §2 (no trade-analysis advice)', () => {
  it.each(ALL_COMMENT_PRESETS.map((p) => [p.id, p.text] as const))(
    '%s carries no forbidden analysis token',
    (_id, text) => {
      const words = new Set(wordsOf(text));
      const lower = text.toLowerCase();

      const hitWord = FORBIDDEN_WORDS.find((w) => words.has(w));
      expect(hitWord, `forbidden word "${hitWord}" found in: ${text}`).toBeUndefined();

      const hitPhrase = FORBIDDEN_PHRASES.find((p) => lower.includes(p));
      expect(hitPhrase, `forbidden phrase "${hitPhrase}" found in: ${text}`).toBeUndefined();
    },
  );

  it('the forbidden-token scanner actually catches a planted violation', () => {
    // Guards the guard: a phrase smuggling a directional call must trip the scan.
    const bad = 'Joli trade, je pense que ça va monter, achète plus haut sur la résistance.';
    const words = new Set(wordsOf(bad));
    const lower = bad.toLowerCase();
    const tripped =
      FORBIDDEN_WORDS.some((w) => words.has(w)) || FORBIDDEN_PHRASES.some((p) => lower.includes(p));
    expect(tripped).toBe(true);
  });
});
