import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';

import { TRAINING_UI_COPY } from './training-ui-copy';

/**
 * S8 RE-CHALLENGE — guardrail for the app-PRODUCED example copy on the training
 * surface (mirror of `training-checklist.guardrail.test.ts`).
 *
 * Two non-negotiables:
 *   1. GARDE-FOU §2 — every example placeholder is STRICTLY psychology /
 *      discipline / execution framing. None may smuggle trade-analysis advice.
 *      Each string runs through the production `detectAMFViolation` so a future
 *      edit that leaks market analysis FAILS CI instead of reaching a member.
 *   2. "Guards the guard" — a planted analysis violation MUST trip the detector,
 *      proving the assertion above is live, not vacuous.
 */

const entries = Object.entries(TRAINING_UI_COPY) as Array<[string, string]>;

describe('TRAINING_UI_COPY — structure', () => {
  it('every example is a non-empty string', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, text] of entries) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('TRAINING_UI_COPY — GARDE-FOU §2 (no trade-analysis advice)', () => {
  it.each(entries)('%s is AMF-safe (detectAMFViolation → not suspected)', (_key, text) => {
    const result = detectAMFViolation(text);
    expect(result.suspected, `matched: ${result.matchedLabels.join(', ')} in "${text}"`).toBe(
      false,
    );
  });

  it('the AMF detector actually trips on a planted analysis violation (guards the guard)', () => {
    const bad = 'Ex. shorte le DAX dès la cassure baissière, vise les 18250.';
    expect(detectAMFViolation(bad).suspected).toBe(true);
  });
});
