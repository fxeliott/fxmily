import { describe, expect, it } from 'vitest';

import { deriveLearningStage } from './learning-stage';

/**
 * D4 — pure learning-stage derivation. The stage is member-authored deep-AI
 * output persisted as Prisma JSON (`unknown`), so coercion must be defensive and
 * validate with the SAME `learningStageSchema` used at write time. The derived
 * view is member-safe: ONLY the enum-derived stage/label/hint, never the raw AI
 * `rationale`/`evidence`.
 */

/** Minimal valid `learningStage` blob (matches `learningStageSchema`). */
function validBlob(stage: 'mechanical' | 'subjective' | 'intuitive') {
  return {
    stage,
    rationale: 'Raisonnement descriptif suffisamment long pour le schema.',
    evidence: ['un extrait verbatim de la reponse du membre'],
  };
}

describe('deriveLearningStage — valid input', () => {
  it('maps mechanical → Mécanique + fixed rule-anchoring hint', () => {
    const out = deriveLearningStage(validBlob('mechanical'));
    expect(out).toEqual({
      stage: 'mechanical',
      label: 'Mécanique',
      hint: 'Ancre tes objectifs sur le respect strict de tes règles.',
    });
  });

  it('maps subjective → Subjectif with a deterministic hint', () => {
    const out = deriveLearningStage(validBlob('subjective'));
    expect(out?.stage).toBe('subjective');
    expect(out?.label).toBe('Subjectif');
    expect(out?.hint).toBe('Travaille ta lecture du marché en gardant ton cadre comme garde-fou.');
  });

  it('maps intuitive → Intuitif with a deterministic hint', () => {
    const out = deriveLearningStage(validBlob('intuitive'));
    expect(out?.stage).toBe('intuitive');
    expect(out?.label).toBe('Intuitif');
    expect(out?.hint).toBe(
      'Consolide ta constance pour que ton process reste fiable dans la durée.',
    );
  });

  it('is deterministic (same input → same output)', () => {
    expect(deriveLearningStage(validBlob('mechanical'))).toEqual(
      deriveLearningStage(validBlob('mechanical')),
    );
  });

  it('NEVER surfaces raw AI text (rationale/evidence) to the member', () => {
    const out = deriveLearningStage(validBlob('mechanical'));
    expect(out).not.toBeNull();
    // Only the enum-derived, member-safe keys — no rationale, no evidence.
    expect(Object.keys(out ?? {}).sort()).toEqual(['hint', 'label', 'stage']);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Raisonnement');
    expect(serialized).not.toContain('verbatim');
  });

  it('no member-facing string contains an em-dash', () => {
    for (const stage of ['mechanical', 'subjective', 'intuitive'] as const) {
      const out = deriveLearningStage(validBlob(stage));
      expect(out?.label).not.toContain('—');
      expect(out?.hint).not.toContain('—');
    }
  });
});

describe('deriveLearningStage — null / absent', () => {
  it('returns null for null / undefined (legacy or partial rows)', () => {
    expect(deriveLearningStage(null)).toBeNull();
    expect(deriveLearningStage(undefined)).toBeNull();
  });
});

describe('deriveLearningStage — garbage / malformed', () => {
  it('returns null for a non-object', () => {
    expect(deriveLearningStage('mechanical')).toBeNull();
    expect(deriveLearningStage(42)).toBeNull();
    expect(deriveLearningStage(['mechanical'])).toBeNull();
  });

  it('returns null for an unknown stage value', () => {
    expect(deriveLearningStage(validBlob('mechanical' as never))).not.toBeNull();
    expect(
      deriveLearningStage({
        stage: 'expert',
        rationale: 'Raisonnement descriptif suffisamment long pour le schema.',
        evidence: ['un extrait'],
      }),
    ).toBeNull();
  });

  it('returns null when required schema fields are missing', () => {
    // Missing rationale/evidence → schema (strict) rejects → null.
    expect(deriveLearningStage({ stage: 'mechanical' })).toBeNull();
  });

  it('returns null for an extra/unknown key (strict schema)', () => {
    expect(
      deriveLearningStage({
        ...validBlob('mechanical'),
        weakSignals: [{ signal: 'should never be read here' }],
      }),
    ).toBeNull();
  });
});
