import { describe, expect, it } from 'vitest';

import type {
  MemberProfileOutput,
  OnboardingInterviewSnapshot,
} from '@/lib/schemas/onboarding-interview';

import {
  composeOutputCorpus,
  detectAMFViolation,
  detectClinicalLanguage,
  isEvidenceVerbatimSubstring,
  runSafetyGate,
  validateDimensionEvidence,
  validateEvidenceSubstrings,
} from './safety';

/**
 * V2.4 Phase A.2 — Safety filters tests (3 couches anti-hallucination §J).
 *
 * Pure unit tests on the runtime validators. No DB, no Prisma, no `server-
 * only` import — safety.ts is consumed by both batch.ts and these tests.
 */

// =============================================================================
// Test fixtures
// =============================================================================

function makeSnapshot(answerTexts: string[]): OnboardingInterviewSnapshot {
  return {
    pseudonymLabel: 'member-aabbccdd',
    instrumentVersion: 'v1',
    startedAt: '2026-05-28T10:00:00.000Z',
    completedAt: '2026-05-28T10:30:00.000Z',
    answers: answerTexts.map((text, idx) => ({
      questionIndex: idx,
      questionKey: `q${idx}`,
      questionText: `Question ${idx}`,
      answerText: text,
      dimensionId: 'discipline_plan_adherence',
      phase: 'core' as const,
    })),
  };
}

function makeOutput(overrides: Partial<MemberProfileOutput> = {}): MemberProfileOutput {
  return {
    summary:
      'Profil descriptif standard du membre — process-focus présent, work in progress sur la discipline plan-adherence. Routine matinale stable. Awareness somatique sous stress.',
    highlights: [
      {
        key: 'standard-highlight-one',
        label: 'Standard highlight 1',
        evidence: ['evidence text from answer'],
      },
      {
        key: 'standard-highlight-two',
        label: 'Standard highlight 2',
        evidence: ['another evidence'],
      },
      {
        key: 'standard-highlight-three',
        label: 'Standard highlight 3',
        evidence: ['third evidence'],
      },
    ],
    axes_prioritaires: [
      'Travailler la consistance du plan personnel',
      'Capitaliser sur les routines déjà solides',
      'Approfondir la self-awareness somatique',
    ],
    ...overrides,
  };
}

// =============================================================================
// detectAMFViolation — Layer 1 (AMF/CIF regex post-gen filter)
// =============================================================================

describe('detectAMFViolation', () => {
  it('detects LONG/SHORT directional advice', () => {
    expect(detectAMFViolation('Prends position LONG sur EURUSD.').suspected).toBe(true);
    expect(detectAMFViolation('Vise un SHORT le DAX.').suspected).toBe(true);
  });

  it('detects buy/sell + achetez/vendez verbs FR + EN', () => {
    expect(detectAMFViolation('Achetez maintenant !').suspected).toBe(true);
    // Canonical detector matches imperative "Vends" (vend[sz]) in trade context
    expect(detectAMFViolation("Vends l'EURUSD à la cassure.").suspected).toBe(true);
    expect(detectAMFViolation('Buy the dip.').suspected).toBe(true);
    expect(detectAMFViolation('Sell the rally.').suspected).toBe(true);
  });

  it('detects specific TP / stop-loss levels', () => {
    expect(detectAMFViolation('TP 1.0850 puis trail.').suspected).toBe(true);
    expect(detectAMFViolation('Stop-loss à 4250.').suspected).toBe(true);
    expect(detectAMFViolation('Objectif à 1.20.').suspected).toBe(true);
  });

  it('detects support/resistance technical advice', () => {
    expect(detectAMFViolation('Niveau de support à surveiller.').suspected).toBe(true);
  });

  it('returns suspected=false on normal coaching language', () => {
    expect(detectAMFViolation('Le membre montre un process-focus solide.').suspected).toBe(false);
    expect(detectAMFViolation('Awareness somatique sous stress.').suspected).toBe(false);
    expect(detectAMFViolation('').suspected).toBe(false);
  });

  it('returns canonical labels only (audit-safe, no raw text)', () => {
    const result = detectAMFViolation('Achetez LONG TP 100.');
    expect(result.suspected).toBe(true);
    for (const label of result.matchedLabels) {
      // Labels are snake_case canonical, never raw text
      expect(label).toMatch(/^[a-z_]+$/);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Anti-FP regression tests (Session 4 — fix for naive duplicate detector)
  //
  // These phrases triggered false positives with the old naïve patterns
  // (directional_long_short on "long terme", directional_buy_sell on "vendu").
  // The canonical context-anchored detector must NOT flag them.
  // ──────────────────────────────────────────────────────────────────────────

  it('anti-FP: "long terme" temporal must NOT be flagged', () => {
    expect(
      detectAMFViolation(
        'Le membre raisonne sur le long terme et a vendu sa position trop tôt par peur.',
      ).suspected,
    ).toBe(false);
  });

  it('anti-FP: "tout au long du mois" idiomatic must NOT be flagged', () => {
    expect(detectAMFViolation('tout au long du mois il garde sa discipline').suspected).toBe(false);
  });

  it('anti-FP: "il a acheté du recul" past tense / figurative must NOT be flagged', () => {
    expect(detectAMFViolation('il a acheté du recul ce mois-ci').suspected).toBe(false);
  });
});

// =============================================================================
// detectClinicalLanguage — Anti-clinical wording (§J posture)
// =============================================================================

describe('detectClinicalLanguage', () => {
  it('detects clinical psychiatric terms', () => {
    expect(detectClinicalLanguage('Le membre montre une dépression sévère.').suspected).toBe(true);
    expect(detectClinicalLanguage('Anxiété généralisée présente.').suspected).toBe(true);
    expect(detectClinicalLanguage('Trouble bipolaire détecté.').suspected).toBe(true);
    expect(detectClinicalLanguage('Pathologie suspectée.').suspected).toBe(true);
    expect(detectClinicalLanguage('Diagnostic à confirmer.').suspected).toBe(true);
  });

  it('excludes trading slang "dépression du marché" (financial context)', () => {
    expect(detectClinicalLanguage('Le membre parle de la dépression du marché.').suspected).toBe(
      false,
    );
  });

  it('returns suspected=false on neutral coaching wording', () => {
    expect(
      detectClinicalLanguage('Périodes de doute observées lors des séries de pertes.').suspected,
    ).toBe(false);
    expect(detectClinicalLanguage('Awareness corporelle solide.').suspected).toBe(false);
    expect(detectClinicalLanguage('').suspected).toBe(false);
  });
});

// =============================================================================
// validateEvidenceSubstrings — Layer 3 (evidence-grounded mandatory)
// =============================================================================

describe('validateEvidenceSubstrings', () => {
  it('passes when every evidence is a verbatim substring of the answers', () => {
    const snapshot = makeSnapshot([
      "J'ai démarré en 2022, blow-up en 3 semaines, retour structuré en 2024.",
      'Honnêtement 4 sur 10. Je dévie souvent sur le target.',
    ]);
    const output = makeOutput({
      highlights: [
        {
          key: 'parcours-blow-up',
          label: 'Parcours blow-up + recovery',
          evidence: ['blow-up en 3 semaines'],
        },
        {
          key: 'gap-plan-execution',
          label: 'Gap exécution plan',
          evidence: ['4 sur 10. Je dévie souvent sur le target.'],
        },
        {
          key: 'process-focus',
          label: 'Process focus',
          evidence: ['retour structuré en 2024.'],
        },
      ],
    });
    const result = validateEvidenceSubstrings(output, snapshot);
    expect(result.allValid).toBe(true);
    expect(result.invalidHighlightIndexes).toHaveLength(0);
  });

  it('flags hallucinated evidence not present in answers', () => {
    const snapshot = makeSnapshot(['Réponse banale du membre.']);
    const output = makeOutput({
      highlights: [
        {
          key: 'real-substring',
          label: 'Real',
          evidence: ['Réponse banale'],
        },
        {
          key: 'hallucinated',
          label: 'Hallucinated',
          evidence: ["Citation que le membre n'a JAMAIS écrite."],
        },
        {
          key: 'another-real',
          label: 'Another real',
          evidence: ['banale du membre.'],
        },
      ],
    });
    const result = validateEvidenceSubstrings(output, snapshot);
    expect(result.allValid).toBe(false);
    expect(result.invalidHighlightIndexes).toEqual([1]);
  });

  it('isEvidenceVerbatimSubstring wrapper works for unit-test friendly API', () => {
    const snapshot = makeSnapshot(['Texte exact du membre.']);
    expect(isEvidenceVerbatimSubstring('Texte exact', snapshot)).toBe(true);
    expect(isEvidenceVerbatimSubstring('Texte inventé', snapshot)).toBe(false);
    expect(isEvidenceVerbatimSubstring('', snapshot)).toBe(false);
  });
});

// =============================================================================
// runSafetyGate — Composite gate (fail-fast order : AMF → clinical → evidence)
// =============================================================================

describe('runSafetyGate', () => {
  it('returns status=pass on clean output + valid evidence', () => {
    const snapshot = makeSnapshot(['Réponse claire avec contenu exploitable.']);
    const output = makeOutput({
      summary:
        "Profil sain : process-focus présent, awareness solide, work in progress sur la consistance des routines. Recommandations alignées Mark Douglas (truths #1+#4) — accepter l'incertitude + calibrer la confidence sur des stats réelles.",
      highlights: [
        {
          key: 'pattern-one',
          label: 'Pattern un',
          evidence: ['Réponse claire avec contenu exploitable.'],
        },
        {
          key: 'pattern-two',
          label: 'Pattern deux',
          evidence: ['Réponse claire'],
        },
        {
          key: 'pattern-three',
          label: 'Pattern trois',
          evidence: ['contenu exploitable.'],
        },
      ],
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('pass');
  });

  it('rejects on AMF violation BEFORE evidence check (fail-fast)', () => {
    const snapshot = makeSnapshot(["L'analyse correspondait à mon plan."]);
    const output = makeOutput({
      summary:
        'Profil avec une forte tendance à acheter LONG sur EURUSD sans plan précis — recommandation marché individualisée. Workflow process-driven en construction. Conseils à privilégier sur la discipline.',
      highlights: [
        {
          key: 'hallucinated-anyway',
          label: 'Hallucinated anyway',
          evidence: ["L'analyse correspondait à mon plan."],
        },
        {
          key: 'second-highlight',
          label: 'Second',
          evidence: ["L'analyse correspondait"],
        },
        {
          key: 'third-highlight',
          label: 'Third',
          evidence: ['mon plan.'],
        },
      ],
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('amf_violation');
    }
  });

  it('rejects on clinical language BEFORE evidence check', () => {
    const snapshot = makeSnapshot(['Texte standard du membre.']);
    const output = makeOutput({
      summary:
        'Le membre montre une dépression sévère et nécessite un suivi clinique urgent. Recommandation : consultation immédiate. Pas un sujet à traiter via coaching seul. Profile préoccupant — escalade requise.',
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('clinical_language');
    }
  });
});

// =============================================================================
// J-A — Deep AI dimensions : evidence grounding + corpus scanning
// =============================================================================

/**
 * Fully-grounded output helper : every J-A dimension's evidence is a verbatim
 * substring of the provided corpus text (so the tests can flip a single field
 * to a fabricated citation and assert the gate rejects it).
 */
function makeOutputWithDimensions(
  corpusText: string,
  overrides: Partial<MemberProfileOutput> = {},
): MemberProfileOutput {
  return makeOutput({
    coaching_tone: {
      register: 'socratique',
      rationale: 'Le membre progresse mieux en questionnant ses propres décisions.',
      evidence: [corpusText],
    },
    learning_stage: {
      stage: 'subjective',
      rationale: 'Il verbalise ses ressentis mais ne les relie pas encore à un process stable.',
      evidence: [corpusText],
    },
    axes_structured: [
      {
        axis: 'Consistance du plan personnel',
        dimensionId: 'discipline_plan_adherence',
        priority: 1,
        evidence: [corpusText],
      },
    ],
    weak_signals: [
      {
        signal: 'Tendance à sur-ajuster après une perte.',
        dimensionId: 'discipline_plan_adherence',
        evidence: [corpusText],
      },
    ],
    ...overrides,
  });
}

describe('validateDimensionEvidence', () => {
  it('allValid=true when every dimension evidence is a verbatim substring', () => {
    const corpus = 'Je remets tout en question après une perte, souvent trop vite.';
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus);
    const result = validateDimensionEvidence(output, snapshot);
    expect(result.allValid).toBe(true);
    expect(result.invalidPaths).toHaveLength(0);
  });

  it('allValid=true when no J-A dimensions are present (optional, back-compat)', () => {
    const snapshot = makeSnapshot(['Réponse banale.']);
    const output = makeOutput(); // no coaching_tone/learning_stage/axes_structured/weak_signals
    const result = validateDimensionEvidence(output, snapshot);
    expect(result.allValid).toBe(true);
    expect(result.invalidPaths).toHaveLength(0);
  });

  it('flags a fabricated citation inside coaching_tone', () => {
    const corpus = 'Réponse réelle du membre présente dans le corpus.';
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus, {
      coaching_tone: {
        register: 'direct',
        rationale: 'Rationale plausible.',
        evidence: ["Phrase que le membre n'a jamais écrite."],
      },
    });
    const result = validateDimensionEvidence(output, snapshot);
    expect(result.allValid).toBe(false);
    expect(result.invalidPaths).toContain('coaching_tone');
  });

  it('flags the exact index of a fabricated axes_structured entry', () => {
    const corpus = 'Contenu authentique du membre pour ancrage.';
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus, {
      axes_structured: [
        {
          axis: 'Axe ancré',
          dimensionId: 'discipline_plan_adherence',
          priority: 1,
          evidence: [corpus],
        },
        {
          axis: 'Axe halluciné',
          dimensionId: 'risk_management',
          priority: 2,
          evidence: ['Citation inventée absente du corpus.'],
        },
      ],
    });
    const result = validateDimensionEvidence(output, snapshot);
    expect(result.allValid).toBe(false);
    expect(result.invalidPaths).toContain('axes_structured[1]');
    expect(result.invalidPaths).not.toContain('axes_structured[0]');
  });
});

describe('composeOutputCorpus (J-A dimension coverage)', () => {
  it('includes coaching_tone / learning_stage rationale + evidence in the scan corpus', () => {
    const output = makeOutput({
      coaching_tone: {
        register: 'direct',
        rationale: 'RATIONALE_TONE_MARKER',
        evidence: ['EVIDENCE_TONE_MARKER'],
      },
      learning_stage: {
        stage: 'mechanical',
        rationale: 'RATIONALE_STAGE_MARKER',
        evidence: ['EVIDENCE_STAGE_MARKER'],
      },
    });
    const corpus = composeOutputCorpus(output);
    expect(corpus).toContain('RATIONALE_TONE_MARKER');
    expect(corpus).toContain('EVIDENCE_TONE_MARKER');
    expect(corpus).toContain('RATIONALE_STAGE_MARKER');
    expect(corpus).toContain('EVIDENCE_STAGE_MARKER');
  });

  it('includes axes_structured.axis + weak_signals.signal in the scan corpus', () => {
    const output = makeOutput({
      axes_structured: [
        {
          axis: 'AXIS_TEXT_MARKER',
          dimensionId: 'discipline_plan_adherence',
          priority: 1,
          evidence: ['AXIS_EVIDENCE_MARKER'],
        },
      ],
      weak_signals: [
        {
          signal: 'SIGNAL_TEXT_MARKER',
          dimensionId: 'discipline_plan_adherence',
          evidence: ['SIGNAL_EVIDENCE_MARKER'],
        },
      ],
    });
    const corpus = composeOutputCorpus(output);
    expect(corpus).toContain('AXIS_TEXT_MARKER');
    expect(corpus).toContain('AXIS_EVIDENCE_MARKER');
    expect(corpus).toContain('SIGNAL_TEXT_MARKER');
    expect(corpus).toContain('SIGNAL_EVIDENCE_MARKER');
  });
});

describe('runSafetyGate (J-A dimensions)', () => {
  it('rejects a fabricated citation living ONLY in a J-A dimension', () => {
    const corpus = 'Réponse authentique et exploitable du membre.';
    const snapshot = makeSnapshot([corpus]);
    // highlights all grounded; only weak_signals carries a fabricated citation.
    const output = makeOutputWithDimensions(corpus, {
      highlights: [
        { key: 'h1', label: 'H1', evidence: [corpus] },
        { key: 'h2', label: 'H2', evidence: ['Réponse authentique'] },
        { key: 'h3', label: 'H3', evidence: ['exploitable du membre.'] },
      ],
      weak_signals: [
        {
          signal: 'Signal halluciné.',
          dimensionId: 'discipline_plan_adherence',
          evidence: ['Citation totalement inventée hors corpus.'],
        },
      ],
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('evidence_invalid');
      if (result.reason === 'evidence_invalid') {
        expect(result.invalidHighlightIndexes).toHaveLength(0);
        expect(result.invalidDimensionPaths).toContain('weak_signals[0]');
      }
    }
  });

  it('does not set invalidDimensionPaths when only a highlight is fabricated', () => {
    const corpus = 'Contenu réel du membre.';
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus, {
      highlights: [
        { key: 'h1', label: 'H1', evidence: ['Halluciné hors corpus.'] },
        { key: 'h2', label: 'H2', evidence: [corpus] },
        { key: 'h3', label: 'H3', evidence: ['Contenu réel'] },
      ],
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('reject');
    if (result.status === 'reject' && result.reason === 'evidence_invalid') {
      expect(result.invalidHighlightIndexes).toEqual([0]);
      expect(result.invalidDimensionPaths).toBeUndefined();
    }
  });

  it('rejects an AMF violation planted in a J-A dimension rationale', () => {
    const corpus = "L'analyse correspondait à mon plan de trading.";
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus, {
      coaching_tone: {
        register: 'direct',
        rationale: 'Achetez LONG sur EURUSD, TP à 1.0850.',
        evidence: [corpus],
      },
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('amf_violation');
    }
  });

  it('passes when all highlights AND all J-A dimensions are grounded and clean', () => {
    const corpus = 'Réponse claire, exploitable, orientée process du membre.';
    const snapshot = makeSnapshot([corpus]);
    const output = makeOutputWithDimensions(corpus, {
      summary:
        'Profil sain, process-focus présent, work in progress sur la consistance. Routines stables, awareness solide, marge de progression sur la gestion post-perte.',
      highlights: [
        { key: 'h1', label: 'H1', evidence: [corpus] },
        { key: 'h2', label: 'H2', evidence: ['Réponse claire'] },
        { key: 'h3', label: 'H3', evidence: ['orientée process du membre.'] },
      ],
    });
    const result = runSafetyGate({ output, snapshot });
    expect(result.status).toBe('pass');
  });
});
