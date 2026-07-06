import { describe, expect, it } from 'vitest';

import {
  EVOLUTION_NARRATIVE_MAX_CHARS,
  EVOLUTION_NARRATIVE_MIN_CHARS,
  memberProfileMonthlySnapshotOutputSchema,
  memberProfileMonthlySnapshotPersistInputSchema,
} from './member-profile-monthly-snapshot';

/**
 * J-E — `MemberProfileMonthlySnapshot` output/persist schema.
 *
 * Proves the ADMIN-ONLY monthly re-profiling contract: a bounded evolution
 * narrative + the 4 onboarding deep dimensions (reused verbatim), all strict,
 * the dims OPTIONAL but strict-when-present. Idempotency + cost travel through
 * the persist layer (mirror monthly-debrief).
 */

// A valid ≥120-char evolution narrative (posture §2 — psycho/process only).
const VALID_NARRATIVE =
  "Ce mois, le membre gagne en régularité d'exécution : le respect du plan progresse et les sorties anticipées par peur reculent nettement, même si l'acceptation de l'incertitude reste le chantier dominant à consolider.";

/** A fully-populated output — narrative + the 4 deep dimensions. */
function validOutput() {
  return {
    evolution_narrative: VALID_NARRATIVE,
    coaching_tone: {
      register: 'pedagogique' as const,
      rationale:
        'Le membre structure mieux son process ce mois ; un registre pédagogique qui ancre des étapes concrètes soutient sa progression.',
      evidence: ["Je suis mon plan plus souvent qu'avant."],
    },
    learning_stage: {
      stage: 'subjective' as const,
      rationale:
        "Le membre applique son plan avec plus d'aisance mais dépend encore de sa lecture subjective des conditions : stade subjective de Douglas.",
      evidence: ['Je sens mieux quand attendre.'],
    },
    axes_structured: [
      {
        axis: "Consolider l'acceptation de l'incertitude avant chaque entrée.",
        dimensionId: 'uncertainty_acceptance',
        priority: 1,
        evidence: ["L'incertitude me stresse encore."],
      },
    ],
    weak_signals: [
      {
        signal: 'Sur-ajustement du risque après une perte, à observer sur le mois suivant.',
        dimensionId: 'risk_discipline',
        evidence: ['Après une perte je réduis trop ma taille.'],
      },
    ],
  };
}

describe('J-E — memberProfileMonthlySnapshotOutputSchema', () => {
  it('parses a fully-populated output (narrative + 4 dims)', () => {
    const parsed = memberProfileMonthlySnapshotOutputSchema.safeParse(validOutput());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.coaching_tone?.register).toBe('pedagogique');
      expect(parsed.data.learning_stage?.stage).toBe('subjective');
      expect(parsed.data.axes_structured).toHaveLength(1);
      expect(parsed.data.weak_signals).toHaveLength(1);
    }
  });

  it('parses a narrative-only output (the 4 dims are OPTIONAL, omitted when signal insufficient)', () => {
    const parsed = memberProfileMonthlySnapshotOutputSchema.safeParse({
      evolution_narrative: VALID_NARRATIVE,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.coaching_tone).toBeUndefined();
      expect(parsed.data.weak_signals).toBeUndefined();
    }
  });

  it('requires the evolution narrative (it is the ONE mandatory field)', () => {
    const { evolution_narrative: _omit, ...rest } = validOutput();
    void _omit;
    expect(memberProfileMonthlySnapshotOutputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a narrative below the min length', () => {
    const short = 'Trop court.';
    expect(short.length).toBeLessThan(EVOLUTION_NARRATIVE_MIN_CHARS);
    expect(
      memberProfileMonthlySnapshotOutputSchema.safeParse({ evolution_narrative: short }).success,
    ).toBe(false);
  });

  it('rejects a narrative above the max length', () => {
    const long = 'a'.repeat(EVOLUTION_NARRATIVE_MAX_CHARS + 1);
    expect(
      memberProfileMonthlySnapshotOutputSchema.safeParse({ evolution_narrative: long }).success,
    ).toBe(false);
  });

  it('is strict — rejects any hallucinated extra key (double-net vs the LLM)', () => {
    const tampered = { ...validOutput(), market_view: 'EURUSD long' };
    const parsed = memberProfileMonthlySnapshotOutputSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
  });

  it('is strict-when-present — a malformed dim is rejected, not silently dropped', () => {
    const badRegister = {
      evolution_narrative: VALID_NARRATIVE,
      coaching_tone: {
        register: 'authoritarian', // not in the enum
        rationale: 'x'.repeat(30),
        evidence: ['abc'],
      },
    };
    expect(memberProfileMonthlySnapshotOutputSchema.safeParse(badRegister).success).toBe(false);
  });

  it('enforces the reused onboarding evidence bound (≤5 items per dim)', () => {
    const tooManyEvidence = {
      evolution_narrative: VALID_NARRATIVE,
      learning_stage: {
        stage: 'mechanical' as const,
        rationale: 'y'.repeat(30),
        evidence: ['a', 'b', 'c', 'd', 'e', 'f'], // 6 > max 5
      },
    };
    expect(memberProfileMonthlySnapshotOutputSchema.safeParse(tooManyEvidence).success).toBe(false);
  });

  it('enforces the reused axes cardinality (≤5 structured axes)', () => {
    const axis = {
      axis: 'Un axe process valide et suffisamment long.',
      dimensionId: 'discipline_plan_adherence',
      priority: 1 as const,
      evidence: ['preuve'],
    };
    const tooManyAxes = {
      evolution_narrative: VALID_NARRATIVE,
      axes_structured: [axis, axis, axis, axis, axis, axis], // 6 > max 5
    };
    expect(memberProfileMonthlySnapshotOutputSchema.safeParse(tooManyAxes).success).toBe(false);
  });
});

describe('J-E — memberProfileMonthlySnapshotPersistInputSchema', () => {
  it('round-trips output + cost + civil-month dates', () => {
    const parsed = memberProfileMonthlySnapshotPersistInputSchema.safeParse({
      ...validOutput(),
      userId: 'clv0abcd1234efgh5678ijkl9',
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T00:00:00.000Z'), // allow-absolute-date injected-clock-anchor
      cost: {
        claudeModel: 'claude-opus-4-8',
        inputTokens: 4200,
        outputTokens: 900,
        costEur: 0,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Cost schema defaults + EUR string coercion (mirror monthly-debrief).
      expect(parsed.data.cost.cacheReadTokens).toBe(0);
      expect(parsed.data.cost.cacheCreateTokens).toBe(0);
      expect(parsed.data.cost.costEur).toBe('0.000000');
    }
  });

  it('rejects an over-long userId (cuid/nanoid + margin guard, max 40)', () => {
    const parsed = memberProfileMonthlySnapshotPersistInputSchema.safeParse({
      evolution_narrative: VALID_NARRATIVE,
      userId: 'x'.repeat(41),
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T00:00:00.000Z'), // allow-absolute-date injected-clock-anchor
      cost: { claudeModel: 'claude-opus-4-8', inputTokens: 1, outputTokens: 1, costEur: 0 },
    });
    expect(parsed.success).toBe(false);
  });
});
