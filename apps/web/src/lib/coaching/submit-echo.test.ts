import { describe, expect, it } from 'vitest';

import {
  buildReflectSubmitEcho,
  buildReviewSubmitEcho,
  type ReflectSubmitEchoInput,
  type ReviewSubmitEchoInput,
  type SubmitEcho,
} from './submit-echo';

/**
 * Tour 11 — decision table of the REFLECT submit echo (finding 3). Pure module:
 * each case pins the PRESENCE-driven variation, the register decline, the stage
 * anchor and the invariants (max 2 lines, no em-dash, tone never red), never the
 * full prose (copy stays editable without test churn).
 */

function reflect(overrides: Partial<ReflectSubmitEchoInput> = {}): ReflectSubmitEchoInput {
  return {
    hasDisputation: false,
    learningStage: null,
    coachingRegister: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewSubmitEchoInput> = {}): ReviewSubmitEchoInput {
  return {
    hasNextWeekFocus: false,
    learningStage: null,
    coachingRegister: null,
    ...overrides,
  };
}

/** The em-dash (U+2014) is banned in every surfaced FR line (Eliott's rule). */
function assertNoEmDash(echo: SubmitEcho): void {
  for (const line of echo.lines) {
    expect(line).not.toContain('—');
  }
  expect(echo.title).not.toContain('—');
}

describe('buildReflectSubmitEcho — presence variation', () => {
  it('a written reframe (disputation) reads the closed ABCD loop', () => {
    const echo = buildReflectSubmitEcho(
      reflect({ hasDisputation: true, coachingRegister: 'direct' }),
    );
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('lecture alternative');
  });

  it('no reframe still reads a calm first step, never a reproach', () => {
    const echo = buildReflectSubmitEcho(
      reflect({ hasDisputation: false, coachingRegister: 'direct' }),
    );
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('premier pas');
  });

  it('the two branches produce DIFFERENT main readings', () => {
    const withReframe = buildReflectSubmitEcho(reflect({ hasDisputation: true }));
    const without = buildReflectSubmitEcho(reflect({ hasDisputation: false }));
    expect(withReframe.lines[0]).not.toBe(without.lines[0]);
  });
});

describe('buildReflectSubmitEcho — register decline', () => {
  it('falls back to the pedagogique register when the profile has none', () => {
    const nullReg = buildReflectSubmitEcho(reflect({ coachingRegister: null }));
    const pedago = buildReflectSubmitEcho(reflect({ coachingRegister: 'pedagogique' }));
    expect(nullReg.lines[0]).toBe(pedago.lines[0]);
  });

  it('each register yields a distinct main line', () => {
    const direct = buildReflectSubmitEcho(reflect({ coachingRegister: 'direct' }));
    const pedago = buildReflectSubmitEcho(reflect({ coachingRegister: 'pedagogique' }));
    const socratique = buildReflectSubmitEcho(reflect({ coachingRegister: 'socratique' }));
    const mains = new Set([direct.lines[0], pedago.lines[0], socratique.lines[0]]);
    expect(mains.size).toBe(3);
  });

  it('the socratique register ends the main reading on a question', () => {
    const echo = buildReflectSubmitEcho(reflect({ coachingRegister: 'socratique' }));
    expect(echo.lines[0]?.trimEnd().endsWith('?')).toBe(true);
  });
});

describe('buildReflectSubmitEcho — stage anchor', () => {
  it('appends a stage anchor line when a learning stage is known', () => {
    const echo = buildReflectSubmitEcho(reflect({ learningStage: 'mechanical' }));
    expect(echo.lines).toHaveLength(2);
    expect(echo.lines[1]?.toLowerCase()).toContain('à ton stade');
  });

  it('omits the anchor (single line) when the stage is null', () => {
    const echo = buildReflectSubmitEcho(reflect({ learningStage: null }));
    expect(echo.lines).toHaveLength(1);
  });

  it('the three stages produce distinct anchors', () => {
    const mech = buildReflectSubmitEcho(reflect({ learningStage: 'mechanical' })).lines[1];
    const subj = buildReflectSubmitEcho(reflect({ learningStage: 'subjective' })).lines[1];
    const intu = buildReflectSubmitEcho(reflect({ learningStage: 'intuitive' })).lines[1];
    expect(new Set([mech, subj, intu]).size).toBe(3);
  });
});

describe('buildReviewSubmitEcho — presence variation', () => {
  it('a next-week focus reads the recul turned into an intention', () => {
    const echo = buildReviewSubmitEcho(review({ hasNextWeekFocus: true }));
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('focus');
  });

  it('no focus still reads a calm acknowledgement of the recul', () => {
    const echo = buildReviewSubmitEcho(
      review({ hasNextWeekFocus: false, coachingRegister: 'direct' }),
    );
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('recul');
  });

  it('the two branches produce DIFFERENT main readings', () => {
    const withFocus = buildReviewSubmitEcho(review({ hasNextWeekFocus: true }));
    const without = buildReviewSubmitEcho(review({ hasNextWeekFocus: false }));
    expect(withFocus.lines[0]).not.toBe(without.lines[0]);
  });
});

describe('buildReviewSubmitEcho — register decline', () => {
  it('falls back to the pedagogique register when the profile has none', () => {
    const nullReg = buildReviewSubmitEcho(review({ coachingRegister: null }));
    const pedago = buildReviewSubmitEcho(review({ coachingRegister: 'pedagogique' }));
    expect(nullReg.lines[0]).toBe(pedago.lines[0]);
  });

  it('each register yields a distinct main line', () => {
    const direct = buildReviewSubmitEcho(review({ coachingRegister: 'direct' }));
    const pedago = buildReviewSubmitEcho(review({ coachingRegister: 'pedagogique' }));
    const socratique = buildReviewSubmitEcho(review({ coachingRegister: 'socratique' }));
    const mains = new Set([direct.lines[0], pedago.lines[0], socratique.lines[0]]);
    expect(mains.size).toBe(3);
  });
});

describe('buildReviewSubmitEcho — stage anchor', () => {
  it('appends a stage anchor line when a learning stage is known', () => {
    const echo = buildReviewSubmitEcho(review({ learningStage: 'intuitive' }));
    expect(echo.lines).toHaveLength(2);
    expect(echo.lines[1]?.toLowerCase()).toContain('à ton stade');
  });

  it('omits the anchor (single line) when the stage is null', () => {
    const echo = buildReviewSubmitEcho(review({ learningStage: null }));
    expect(echo.lines).toHaveLength(1);
  });
});

describe('submit echo — posture invariants', () => {
  it('reflect echo never exceeds 2 lines and never carries an em-dash', () => {
    for (const hasDisputation of [true, false]) {
      for (const stage of ['mechanical', 'subjective', 'intuitive', null] as const) {
        for (const reg of ['direct', 'pedagogique', 'socratique', null] as const) {
          const echo = buildReflectSubmitEcho(
            reflect({ hasDisputation, learningStage: stage, coachingRegister: reg }),
          );
          expect(echo.lines.length).toBeGreaterThanOrEqual(1);
          expect(echo.lines.length).toBeLessThanOrEqual(2);
          assertNoEmDash(echo);
          // Never red: the tone is a calm acknowledgement, never an outcome.
          expect(echo.tone).toBe('ok');
        }
      }
    }
  });

  it('review echo never exceeds 2 lines and never carries an em-dash', () => {
    for (const hasNextWeekFocus of [true, false]) {
      for (const stage of ['mechanical', 'subjective', 'intuitive', null] as const) {
        for (const reg of ['direct', 'pedagogique', 'socratique', null] as const) {
          const echo = buildReviewSubmitEcho(
            review({ hasNextWeekFocus, learningStage: stage, coachingRegister: reg }),
          );
          expect(echo.lines.length).toBeGreaterThanOrEqual(1);
          expect(echo.lines.length).toBeLessThanOrEqual(2);
          assertNoEmDash(echo);
          expect(echo.tone).toBe('ok');
        }
      }
    }
  });
});
