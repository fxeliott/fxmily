import { describe, expect, it } from 'vitest';

import {
  buildDayWrap,
  buildEveningCheckinEcho,
  buildMorningCheckinEcho,
  HIGH_STRESS_THRESHOLD,
  LOW_MOOD_THRESHOLD,
  LOW_SLEEP_THRESHOLD,
  type EveningCheckinEchoInput,
  type MorningCheckinEchoInput,
} from './checkin-echo';

/**
 * Tour 11 — decision table of the living check-in echo. Pure module: each case
 * pins the SELECTED signal (priority order), the tone and the register
 * variation, never the full prose (copy stays editable without test churn).
 */

function morning(overrides: Partial<MorningCheckinEchoInput> = {}): MorningCheckinEchoInput {
  return {
    moodScore: null,
    sleepQuality: null,
    emotionTags: [],
    learningStage: null,
    coachingRegister: null,
    ...overrides,
  };
}

function evening(overrides: Partial<EveningCheckinEchoInput> = {}): EveningCheckinEchoInput {
  return {
    planRespectedToday: null,
    stressScore: null,
    intentionKept: null,
    emotionTags: [],
    learningStage: null,
    coachingRegister: null,
    ...overrides,
  };
}

describe('buildMorningCheckinEcho — signal priority', () => {
  it('a negative emotion wins over everything (tone watch)', () => {
    const echo = buildMorningCheckinEcho(
      morning({ emotionTags: ['anxious'], moodScore: 2, sleepQuality: 1 }),
    );
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]).toContain('sous tension');
  });

  it('low mood AND short night combine into the low-energy reading', () => {
    const echo = buildMorningCheckinEcho(
      morning({ moodScore: LOW_MOOD_THRESHOLD, sleepQuality: LOW_SLEEP_THRESHOLD }),
    );
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('humeur basse');
    expect(echo.lines[0]?.toLowerCase()).toContain('sommeil');
  });

  it('low mood alone is mirrored (tone watch)', () => {
    const echo = buildMorningCheckinEcho(morning({ moodScore: 3, sleepQuality: 4 }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('humeur basse');
  });

  it('a short night alone is mirrored (tone watch)', () => {
    const echo = buildMorningCheckinEcho(morning({ moodScore: 7, sleepQuality: 1 }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('sommeil léger');
    // Not the combined low-energy branch: mood was fine, so no "humeur basse".
    expect(echo.lines[0]?.toLowerCase()).not.toContain('humeur basse');
  });

  it('a calm positive start reads as reinforcement (tone ok)', () => {
    const echo = buildMorningCheckinEcho(
      morning({ emotionTags: ['calm'], moodScore: 8, sleepQuality: 4 }),
    );
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('posé');
  });

  it('null passthrough: no self-report never fabricates a signal (tone neutral)', () => {
    const echo = buildMorningCheckinEcho(morning());
    expect(echo.tone).toBe('neutral');
    expect(echo.lines).toHaveLength(1);
  });

  it('a high mood number does not trigger the low-mood branch', () => {
    const echo = buildMorningCheckinEcho(morning({ moodScore: 9 }));
    expect(echo.tone).toBe('neutral');
  });
});

describe('buildMorningCheckinEcho — personalisation', () => {
  it('the socratique register phrases the SAME signal as a question', () => {
    const base = morning({ moodScore: 2 });
    const pedago = buildMorningCheckinEcho(base);
    const socra = buildMorningCheckinEcho({ ...base, coachingRegister: 'socratique' });
    expect(pedago.lines[0]).not.toBe(socra.lines[0]);
    expect(socra.lines[0]?.trim().endsWith('?')).toBe(true);
  });

  it('defaults to pedagogique when the profile is absent', () => {
    const anon = buildMorningCheckinEcho(morning({ moodScore: 2 }));
    const explicit = buildMorningCheckinEcho(
      morning({ moodScore: 2, coachingRegister: 'pedagogique' }),
    );
    expect(anon.lines[0]).toBe(explicit.lines[0]);
  });

  it('appends the stage anchor as a second line, capped at 2', () => {
    const echo = buildMorningCheckinEcho(morning({ moodScore: 2, learningStage: 'mechanical' }));
    expect(echo.lines).toHaveLength(2);
    expect(echo.lines[1]).toContain('respect strict de tes règles');
  });
});

describe('buildEveningCheckinEcho — signal priority', () => {
  it('a broken plan wins (tone watch)', () => {
    const echo = buildEveningCheckinEcho(
      evening({ planRespectedToday: false, intentionKept: false, stressScore: 9 }),
    );
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('plan');
  });

  it('a missed intention is mirrored when the plan held', () => {
    const echo = buildEveningCheckinEcho(
      evening({ planRespectedToday: true, intentionKept: false }),
    );
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('intention');
  });

  it('high stress + charged emotion combine into the tense-day reading', () => {
    const echo = buildEveningCheckinEcho(
      evening({ stressScore: HIGH_STRESS_THRESHOLD, emotionTags: ['frustrated'] }),
    );
    expect(echo.tone).toBe('watch');
    // Tense-day branch = stress AND a charged emotion → mentions both.
    expect(echo.lines[0]?.toLowerCase()).toContain('émotions à vif');
  });

  it('high stress alone is mirrored', () => {
    const echo = buildEveningCheckinEcho(evening({ stressScore: 8, emotionTags: ['calm'] }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('stress');
  });

  it('plan held AND intention kept reads as a day-of-process (tone ok)', () => {
    const echo = buildEveningCheckinEcho(
      evening({ planRespectedToday: true, intentionKept: true }),
    );
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]?.toLowerCase()).toContain('plan tenu');
    expect(echo.lines[0]?.toLowerCase()).toContain('intention respectée');
  });

  it('null passthrough: all-null evening stays neutral, never fabricates a miss', () => {
    const echo = buildEveningCheckinEcho(evening());
    expect(echo.tone).toBe('neutral');
    expect(echo.lines).toHaveLength(1);
  });

  it('a single null side never counts as a held day', () => {
    const echo = buildEveningCheckinEcho(
      evening({ planRespectedToday: true, intentionKept: null }),
    );
    expect(echo.tone).toBe('neutral');
  });
});

describe('buildDayWrap — factual, null-passthrough close of day', () => {
  it('composes only the true facts, capitalised, ending on a process closer', () => {
    const lines = buildDayWrap({
      tradesToday: 2,
      planRespectedToday: true,
      intentionKept: true,
      formationFollowed: null,
    });
    expect(lines[0]).toBe("Aujourd'hui : 2 trades journalisés, intention tenue, plan respecté.");
    expect(lines[1]).toContain('process');
  });

  it('singular trade wording when exactly one', () => {
    const lines = buildDayWrap({
      tradesToday: 1,
      planRespectedToday: null,
      intentionKept: null,
      formationFollowed: null,
    });
    expect(lines[0]).toBe("Aujourd'hui : 1 trade journalisé.");
  });

  it('surfaces a false self-report as a soft "à revoir/retravailler", never red', () => {
    const lines = buildDayWrap({
      tradesToday: 0,
      planRespectedToday: false,
      intentionKept: false,
      formationFollowed: null,
    });
    expect(lines[0]?.toLowerCase()).toContain('intention à revoir');
    expect(lines[0]?.toLowerCase()).toContain('plan à retravailler');
    expect(lines[1]).toContain('demain matin');
  });

  it('null passthrough: nothing true to report → warm close, no fabricated facts', () => {
    const lines = buildDayWrap({
      tradesToday: 0,
      planRespectedToday: null,
      intentionKept: null,
      formationFollowed: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('bouclée');
    expect(lines[0]).not.toContain('trade');
  });

  it('includes formation only when explicitly followed', () => {
    const followed = buildDayWrap({
      tradesToday: 0,
      planRespectedToday: null,
      intentionKept: null,
      formationFollowed: true,
    });
    expect(followed[0]?.toLowerCase()).toContain('formation suivie');

    const notFollowed = buildDayWrap({
      tradesToday: 0,
      planRespectedToday: null,
      intentionKept: null,
      formationFollowed: false,
    });
    // A `false` formation is silence, not a fact worth surfacing.
    expect(notFollowed[0]).not.toContain('formation');
  });
});
