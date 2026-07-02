import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';

import { TRAINING_CHECKLIST_ITEMS, trainingTradeCreateSchema } from './training-trade';

/**
 * S8 V2 §33-2 — guardrail for the process-discipline checklist.
 *
 * The checklist descriptors are member-visible (wizard step + backtest detail).
 * Two non-negotiables, mirroring `comment-presets.test.ts`:
 *   1. GARDE-FOU §2 — every `label` + `help` is STRICTLY psychology / discipline
 *      / execution-respect. NONE may smuggle trade-analysis advice. We run each
 *      string through the production `detectAMFViolation` (the same detector the
 *      AI-output gate uses) so a future edit that leaks market analysis FAILS CI
 *      rather than reaching a member.
 *   2. Each checklist key must be accepted by the create schema as a tri-state
 *      (`'true' | 'false' | 'na'`) AND be omittable (optional), so the wizard can
 *      submit a backtest with the checklist untouched.
 */

const BASE_VALID_BACKTEST = {
  pair: 'EURUSD',
  // J1 — the TradingView link is the required primary field.
  tradingViewUrl: 'https://www.tradingview.com/x/NQe0OrXz/',
  plannedRR: 2,
  systemRespected: 'na' as const,
  lessonLearned: 'Entrée patiente sur retest, process tenu de bout en bout.',
  enteredAt: new Date('2026-06-10T10:00:00.000Z'),
};

describe('TRAINING_CHECKLIST_ITEMS — structure', () => {
  it('declares exactly the four discipline items, keys unique', () => {
    expect(TRAINING_CHECKLIST_ITEMS).toHaveLength(4);
    const keys = TRAINING_CHECKLIST_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'planFollowed',
      'riskDefinedBefore',
      'emotionalStateNoted',
      'noImpulsiveDeviation',
    ]);
  });

  it('gives every item a non-empty label and help', () => {
    for (const item of TRAINING_CHECKLIST_ITEMS) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.help.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('TRAINING_CHECKLIST_ITEMS — GARDE-FOU §2 (no trade-analysis advice)', () => {
  const scanned = TRAINING_CHECKLIST_ITEMS.flatMap((i) => [
    [`${i.key} (label)`, i.label] as const,
    [`${i.key} (help)`, i.help] as const,
  ]);

  it.each(scanned)('%s is AMF-safe (detectAMFViolation → not suspected)', (_where, text) => {
    const result = detectAMFViolation(text);
    expect(result.suspected, `matched: ${result.matchedLabels.join(', ')} in "${text}"`).toBe(
      false,
    );
  });
});

describe('checklist tri-state is optional + accepted by the create schema', () => {
  it('accepts a backtest with the checklist fully untouched', () => {
    const parsed = trainingTradeCreateSchema.safeParse(BASE_VALID_BACKTEST);
    expect(parsed.success).toBe(true);
  });

  it.each(TRAINING_CHECKLIST_ITEMS.map((i) => i.key))(
    'accepts %s as true / false / na and maps to boolean | null',
    (key) => {
      for (const [token, expected] of [
        ['true', true],
        ['false', false],
        ['na', null],
      ] as const) {
        const parsed = trainingTradeCreateSchema.safeParse({
          ...BASE_VALID_BACKTEST,
          [key]: token,
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect((parsed.data as Record<string, unknown>)[key]).toBe(expected);
        }
      }
    },
  );

  it('the AMF detector actually trips on a planted analysis violation (guards the guard)', () => {
    const bad = 'As-tu acheté la cassure de résistance avant le breakout haussier ?';
    expect(detectAMFViolation(bad).suspected).toBe(true);
  });
});
