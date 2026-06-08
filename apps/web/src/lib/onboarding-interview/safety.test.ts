import { describe, expect, it } from 'vitest';

import type {
  MemberProfileOutput,
  OnboardingInterviewSnapshot,
} from '@/lib/schemas/onboarding-interview';

import {
  detectAMFViolation,
  detectClinicalLanguage,
  isEvidenceVerbatimSubstring,
  runSafetyGate,
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
