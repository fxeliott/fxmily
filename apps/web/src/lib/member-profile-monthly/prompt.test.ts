import { describe, expect, it } from 'vitest';

import { memberProfileMonthlySnapshotOutputSchema } from '@/lib/schemas/member-profile-monthly-snapshot';

import {
  buildMonthlyReprofileSystemPrompt,
  buildMonthlyReprofileUserPrompt,
  MEMBER_PROFILE_MONTHLY_FEW_SHOT_EXAMPLES,
  MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA,
  MEMBER_PROFILE_MONTHLY_REPROFILE_SYSTEM_PROMPT,
} from './prompt';
import type { MemberProfileMonthlySnapshotOutput } from '@/lib/schemas/member-profile-monthly-snapshot';
import type { MonthlyReprofileSnapshot } from './types';

/** Collect every evidence[] string across the 4 optional dims of an output. */
function allEvidence(output: MemberProfileMonthlySnapshotOutput): string[] {
  const out: string[] = [];
  if (output.coaching_tone) out.push(...output.coaching_tone.evidence);
  if (output.learning_stage) out.push(...output.learning_stage.evidence);
  for (const a of output.axes_structured ?? []) out.push(...a.evidence);
  for (const s of output.weak_signals ?? []) out.push(...s.evidence);
  return out;
}

describe('J-E — monthly few-shot examples (self-grounded, J-B lesson)', () => {
  it('every example output validates against the real Zod output schema', () => {
    for (const example of MEMBER_PROFILE_MONTHLY_FEW_SHOT_EXAMPLES) {
      const parsed = memberProfileMonthlySnapshotOutputSchema.safeParse(
        JSON.parse(example.assistantOutput),
      );
      expect(parsed.success).toBe(true);
    }
  });

  it('every example evidence is a verbatim substring of its OWN reflections (teaches grounding)', () => {
    for (const example of MEMBER_PROFILE_MONTHLY_FEW_SHOT_EXAMPLES) {
      const output = JSON.parse(example.assistantOutput) as MemberProfileMonthlySnapshotOutput;
      const corpus = example.userPrompt.normalize('NFC');
      for (const evidence of allEvidence(output)) {
        expect(corpus.includes(evidence.normalize('NFC'))).toBe(true);
      }
    }
  });

  it('has at least 2 examples that between them cover all 4 dimensions', () => {
    expect(MEMBER_PROFILE_MONTHLY_FEW_SHOT_EXAMPLES.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    for (const example of MEMBER_PROFILE_MONTHLY_FEW_SHOT_EXAMPLES) {
      const output = JSON.parse(example.assistantOutput) as MemberProfileMonthlySnapshotOutput;
      if (output.coaching_tone) seen.add('coaching_tone');
      if (output.learning_stage) seen.add('learning_stage');
      if (output.axes_structured) seen.add('axes_structured');
      if (output.weak_signals) seen.add('weak_signals');
    }
    expect(seen).toEqual(
      new Set(['coaching_tone', 'learning_stage', 'axes_structured', 'weak_signals']),
    );
  });
});

describe('J-E — buildMonthlyReprofileSystemPrompt', () => {
  it('carries the base posture AND the rendered few-shot block (examples must travel)', () => {
    const full = buildMonthlyReprofileSystemPrompt();
    expect(full.startsWith(MEMBER_PROFILE_MONTHLY_REPROFILE_SYSTEM_PROMPT)).toBe(true);
    expect(full).toContain('EXEMPLES DE RÉFÉRENCE');
    // The exemplar reflections reach the wire (J-B: unenforced examples = zero-shot).
    expect(full).toContain('member-9F3A2C71');
  });

  it('locks the anti-clinical + anti-AMF posture', () => {
    expect(MEMBER_PROFILE_MONTHLY_REPROFILE_SYSTEM_PROMPT).toContain('anti-clinical strict');
    expect(MEMBER_PROFILE_MONTHLY_REPROFILE_SYSTEM_PROMPT).toContain('INTERDIT');
    expect(MEMBER_PROFILE_MONTHLY_REPROFILE_SYSTEM_PROMPT).toContain('evolution_narrative');
  });
});

describe('J-E — buildMonthlyReprofileUserPrompt', () => {
  function snap(over: Partial<MonthlyReprofileSnapshot> = {}): MonthlyReprofileSnapshot {
    return {
      pseudonymLabel: 'member-ABCDEF12',
      timezone: 'Europe/Paris',
      monthStartLocal: '2026-06-01',
      monthEndLocal: '2026-06-30',
      accountAgeDaysInWindow: 30,
      reflections: [
        { source: 'intention', localDate: '2026-06-02', text: 'Rester patient aujourd’hui.' },
        { source: 'journal', localDate: '2026-06-05', text: 'Coupé un gagnant trop tôt.' },
      ],
      baseline: {
        coachingRegister: 'pedagogique',
        learningStage: 'mechanical',
        onboardingSummary: 'Portrait onboarding du membre.',
        previousMonth: {
          monthStartLocal: '2026-05-01',
          evolutionNarrative: 'SENTINEL_PREV_NARRATIVE',
          coachingRegister: 'pedagogique',
          learningStage: 'mechanical',
        },
        coachCorrections: [],
      },
      processSignals: {
        reflectionCount: 2,
        tradeCount: 3,
        checkinCount: 2,
        tagFrequencies: [{ tag: 'stress', count: 4 }],
      },
      ...over,
    };
  }

  it('renders the header, window, reflections (wrapped untrusted) and the format lockdown', () => {
    const prompt = buildMonthlyReprofileUserPrompt(snap());
    expect(prompt).toContain('member-ABCDEF12');
    expect(prompt).toContain('2026-06-01');
    expect(prompt).toContain('member_reflection_untrusted'); // untrusted wrap present
    expect(prompt).toContain('Coupé un gagnant trop tôt.'); // reflection text is citable
    expect(prompt).toContain('evolution_narrative'); // lockdown
    expect(prompt).toContain("UNIQUEMENT l'objet JSON");
  });

  it('renders the baseline / previous-month narrative as NON-citable reference context', () => {
    const prompt = buildMonthlyReprofileUserPrompt(snap());
    expect(prompt).toContain('NE PAS citer');
    expect(prompt).toContain('SENTINEL_PREV_NARRATIVE');
    // The reference block precedes the citable reflections block.
    expect(prompt.indexOf('NE PAS citer')).toBeLessThan(prompt.indexOf('SOURCE CITABLE'));
  });

  it('renders coach corrections INSIDE the NON-citable reference block (J-AI corrections echo)', () => {
    const prompt = buildMonthlyReprofileUserPrompt(
      snap({
        baseline: {
          coachingRegister: null,
          learningStage: null,
          onboardingSummary: null,
          previousMonth: null,
          coachCorrections: ['« Exécution » : SENTINEL_CORRECTION_TEXT'],
        },
      }),
    );
    expect(prompt).toContain('Corrections du coach ce mois');
    expect(prompt).toContain('SENTINEL_CORRECTION_TEXT');
    // The correction sits in the "NE PAS citer" reference block, BEFORE the citable corpus.
    expect(prompt.indexOf('SENTINEL_CORRECTION_TEXT')).toBeLessThan(
      prompt.indexOf('SOURCE CITABLE'),
    );
    expect(prompt.indexOf('NE PAS citer')).toBeLessThan(prompt.indexOf('SENTINEL_CORRECTION_TEXT'));
    // Admin free-text is wrapped untrusted (defense-in-depth).
    expect(prompt).toContain('member_reflection_untrusted');
  });

  it('handles a silent month (no reflections) without fabricating', () => {
    const prompt = buildMonthlyReprofileUserPrompt(snap({ reflections: [] }));
    expect(prompt).toContain("N'invente rien");
    expect(prompt).not.toContain('member_reflection_untrusted');
  });
});

describe('J-E — MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA (mirrors the Zod contract)', () => {
  it('requires only evolution_narrative and exposes the 4 optional dims, strict', () => {
    const schema = MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA;
    expect(schema.required).toEqual(['evolution_narrative']);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'axes_structured',
      'coaching_tone',
      'evolution_narrative',
      'learning_stage',
      'weak_signals',
    ]);
  });
});
