import { describe, expect, it } from 'vitest';

import { ONBOARDING_INTERVIEW_SYSTEM_PROMPT } from './prompt';

/**
 * V2.4 safety hardening (2026-05-29) — anti-regression on the distress /
 * crisis-signal block of the onboarding analyzer system prompt.
 *
 * The block mitigates the Opus 4.8 residual API distress risk (no
 * means-substitution, human-support routing, no unsolicited emotional /
 * clinical interpretation). This system prompt rides in the `/pull` envelope
 * to the local `claude --print` batch — if a future edit drops these
 * instructions, the analyzer silently loses a safety layer. These assertions
 * fail loudly instead.
 */
describe('ONBOARDING_INTERVIEW_SYSTEM_PROMPT — distress safety block', () => {
  it('contains the distress / crisis-signal security section', () => {
    expect(ONBOARDING_INTERVIEW_SYSTEM_PROMPT).toContain('SÉCURITÉ — DÉTRESSE');
  });

  it('forbids means-substitution explicitly', () => {
    expect(ONBOARDING_INTERVIEW_SYSTEM_PROMPT).toContain('substitution de moyen');
  });

  it('routes distress to human intervention, not the analyzer', () => {
    expect(ONBOARDING_INTERVIEW_SYSTEM_PROMPT).toContain('intervention humaine');
  });

  it('forbids unsolicited emotional / clinical interpretation', () => {
    expect(ONBOARDING_INTERVIEW_SYSTEM_PROMPT).toContain('interprétation émotionnelle');
  });
});
