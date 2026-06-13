/**
 * Shared AI-output gate — S5 10e challenge (D4-01).
 *
 * The helper is the single source of truth for "is this AI text safe to
 * persist". These tests pin the precedence (crisis > amf), the pass-through of
 * raw detector results, and the clean path.
 */

import { describe, expect, it } from 'vitest';

import { screenAiOutputText } from './ai-output-gate';

describe('screenAiOutputText', () => {
  it('clean coaching text → not blocked', () => {
    const r = screenAiOutputText(
      'Ta discipline progresse. Réduis ta taille vers 1.00% pour rester serein.',
    );
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.amf.suspected).toBe(false);
    expect(r.crisis.level).toBe('none');
  });

  it('AMF directional advice → blocked, reason amf', () => {
    const r = screenAiOutputText("Passe long sur l'or dès l'ouverture.");
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('amf');
    expect(r.amf.suspected).toBe(true);
  });

  it('empty / null corpus → not blocked', () => {
    expect(screenAiOutputText('').blocked).toBe(false);
    expect(screenAiOutputText(null).blocked).toBe(false);
    expect(screenAiOutputText(undefined).blocked).toBe(false);
  });

  it('crisis HIGH takes precedence over a co-occurring AMF match', () => {
    // crisis high + amf in one corpus → must classify as crisis, not amf skip.
    const r = screenAiOutputText("Je veux me suicider. Passe long sur l'or maintenant.");
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('crisis_high');
    expect(r.amf.suspected).toBe(true); // amf also present, but crisis wins
  });

  it('reason maps to the right detector payload', () => {
    const r = screenAiOutputText("Vise vers 1.0850 sur l'euro.");
    expect(r.reason).toBe('amf');
    expect(r.amf.matchedLabels.length).toBeGreaterThan(0);
  });
});
