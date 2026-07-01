import { describe, expect, it } from 'vitest';

import type { MemberProfileMonthlySnapshotOutput } from '@/lib/schemas/member-profile-monthly-snapshot';

import {
  composeMonthlyOutputCorpus,
  runMonthlyReprofileSafetyGate,
  validateMonthlyDimensionEvidence,
} from './safety';

/**
 * J-E — ADMIN-ONLY monthly re-profiling safety gate.
 *
 * Proves the gate wires the two reused onboarding detectors (AMF + anti-
 * clinical) around the monthly output shape, and grounds every re-profiled
 * dimension evidence[] in the month's reflection corpus (verbatim NFC substring)
 * — the same anti-hallucination guarantee as the onboarding batch, adapted to
 * the fact the monthly output has no summary/highlights/axes_prioritaires.
 */

// A reflection corpus (the member's own words) every valid evidence[] quotes.
const CORPUS = [
  'Je suis mon plan plus souvent que le mois dernier.',
  'Je sens mieux quand attendre mon setup.',
  "L'incertitude me stresse encore avant chaque entree.",
  'Apres une perte je reduis trop ma taille.',
].join('\n');

function validOutput(): MemberProfileMonthlySnapshotOutput {
  return {
    evolution_narrative:
      "Ce mois, le respect du plan progresse et les sorties anticipees par peur reculent ; l'acceptation de l'incertitude reste le chantier dominant.",
    coaching_tone: {
      register: 'pedagogique',
      rationale:
        'Le membre structure mieux son process ; un registre pedagogique soutient sa progression.',
      evidence: ['Je suis mon plan plus souvent que le mois dernier.'],
    },
    learning_stage: {
      stage: 'subjective',
      rationale:
        'Il applique son plan avec plus de fluidite mais depend encore de sa lecture subjective.',
      evidence: ['Je sens mieux quand attendre mon setup.'],
    },
    axes_structured: [
      {
        axis: "Consolider l'acceptation de l'incertitude avant chaque entree.",
        dimensionId: 'uncertainty_acceptance',
        priority: 1,
        evidence: ["L'incertitude me stresse encore avant chaque entree."],
      },
    ],
    weak_signals: [
      {
        signal: 'Sur-ajustement du risque apres une perte, a observer le mois suivant.',
        dimensionId: 'risk_discipline',
        evidence: ['Apres une perte je reduis trop ma taille.'],
      },
    ],
  };
}

describe('J-E — composeMonthlyOutputCorpus', () => {
  it('includes the narrative + every dimension text (single source for AMF/clinical scan)', () => {
    const corpus = composeMonthlyOutputCorpus(validOutput());
    expect(corpus).toContain('acceptation'); // narrative
    expect(corpus).toContain('registre pedagogique'); // coaching_tone rationale
    expect(corpus).toContain('lecture subjective'); // learning_stage rationale
    expect(corpus).toContain("Consolider l'acceptation"); // axes_structured axis
    expect(corpus).toContain('Sur-ajustement du risque'); // weak_signals signal
  });
});

describe('J-E — validateMonthlyDimensionEvidence', () => {
  it('passes when every dimension evidence is a verbatim substring of the corpus', () => {
    const result = validateMonthlyDimensionEvidence(validOutput(), CORPUS);
    expect(result.allValid).toBe(true);
    expect(result.invalidPaths).toEqual([]);
  });

  it('reports the exact path of a fabricated citation', () => {
    const out = validOutput();
    const tampered: MemberProfileMonthlySnapshotOutput = {
      ...out,
      axes_structured: [
        { ...out.axes_structured![0]!, evidence: ['Citation totalement inventee.'] },
      ],
    };
    const result = validateMonthlyDimensionEvidence(tampered, CORPUS);
    expect(result.allValid).toBe(false);
    expect(result.invalidPaths).toEqual(['axes_structured[0]']);
  });

  it('is NFC-normalised (a decomposed citation matches a composed corpus)', () => {
    const composedCorpus = 'régularité'.normalize('NFC');
    const out: MemberProfileMonthlySnapshotOutput = {
      evolution_narrative: 'x'.repeat(120),
      coaching_tone: {
        register: 'direct',
        rationale: 'r',
        evidence: ['régularité'.normalize('NFD')],
      },
    };
    expect(validateMonthlyDimensionEvidence(out, composedCorpus).allValid).toBe(true);
  });
});

describe('J-E — runMonthlyReprofileSafetyGate', () => {
  it('passes a clean, fully-grounded output', () => {
    expect(runMonthlyReprofileSafetyGate({ output: validOutput(), sourceCorpus: CORPUS })).toEqual({
      status: 'pass',
    });
  });

  it('rejects an AMF directional recommendation (reused detector)', () => {
    const out: MemberProfileMonthlySnapshotOutput = {
      ...validOutput(),
      evolution_narrative:
        'Le membre progresse mais reste impatient ; achetez maintenant serait tentant.',
    };
    const result = runMonthlyReprofileSafetyGate({ output: out, sourceCorpus: CORPUS });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('amf_violation');
    }
  });

  it('rejects clinical wording (reused anti-clinical detector)', () => {
    const out: MemberProfileMonthlySnapshotOutput = {
      ...validOutput(),
      evolution_narrative:
        'Le membre montre les signes evidents et pose un diagnostic sur son propre comportement.',
    };
    const result = runMonthlyReprofileSafetyGate({ output: out, sourceCorpus: CORPUS });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('clinical_language');
    }
  });

  it('rejects fabricated dimension evidence', () => {
    const out = validOutput();
    const tampered: MemberProfileMonthlySnapshotOutput = {
      ...out,
      weak_signals: [{ ...out.weak_signals![0]!, evidence: ['Jamais dit par le membre.'] }],
    };
    const result = runMonthlyReprofileSafetyGate({ output: tampered, sourceCorpus: CORPUS });
    expect(result.status).toBe('reject');
    if (result.status === 'reject' && result.reason === 'evidence_invalid') {
      expect(result.invalidDimensionPaths).toContain('weak_signals[0]');
    } else {
      throw new Error(`expected evidence_invalid, got ${result.status}`);
    }
  });

  it('short-circuits AMF before evidence (an output with BOTH reports amf_violation)', () => {
    const out: MemberProfileMonthlySnapshotOutput = {
      ...validOutput(),
      evolution_narrative: 'achetez maintenant',
      weak_signals: [{ ...validOutput().weak_signals![0]!, evidence: ['Citation inventee.'] }],
    };
    const result = runMonthlyReprofileSafetyGate({ output: out, sourceCorpus: CORPUS });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('amf_violation');
    }
  });
});
