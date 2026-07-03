import { describe, expect, it } from 'vitest';

import {
  buildTradeCloseEcho,
  buildTradeOpenEcho,
  echoProfileDims,
  ECHO_WINDOW_HOURS,
  LOSS_STREAK_ECHO_THRESHOLD,
  type TradeCloseEchoInput,
  type TradeOpenEchoInput,
} from './trade-echo';

/**
 * Tour 10 — decision table of the living close echo. Pure module: every case
 * pins the SELECTED signal (priority order), the tone and the register
 * variation, never the full prose (copy stays editable without test churn).
 */

const NOW = new Date('2026-07-03T18:00:00Z');
const FRESH_CLOSE = '2026-07-03T12:00:00Z'; // 6h ago — inside the window

function input(overrides: Partial<TradeCloseEchoInput> = {}): TradeCloseEchoInput {
  return {
    closedAt: FRESH_CLOSE,
    outcome: 'win',
    exitReason: null,
    planRespected: true,
    processComplete: null,
    slPerRule: null,
    movedToBe: null,
    partialAtTarget: null,
    emotionDuring: ['calm'],
    openDiscrepancyCount: 0,
    learningStage: null,
    coachingRegister: null,
    now: NOW,
    ...overrides,
  };
}

describe('buildTradeCloseEcho — freshness gate', () => {
  it('returns null for an open trade', () => {
    expect(buildTradeCloseEcho(input({ closedAt: null }))).toBeNull();
  });

  it('returns null once the close is older than the window', () => {
    const stale = new Date(NOW.getTime() - (ECHO_WINDOW_HOURS + 1) * 60 * 60 * 1000).toISOString();
    expect(buildTradeCloseEcho(input({ closedAt: stale }))).toBeNull();
  });

  it('returns null on a malformed closedAt instead of throwing', () => {
    expect(buildTradeCloseEcho(input({ closedAt: 'not-a-date' }))).toBeNull();
  });
});

describe('buildTradeCloseEcho — signal priority', () => {
  it('fear exit wins over everything (manual before target + negative emotion)', () => {
    const echo = buildTradeCloseEcho(
      input({
        exitReason: 'manual_before_target',
        emotionDuring: ['fear-loss'],
        planRespected: false, // would match planBroken, but fearExit outranks it
      }),
    );
    expect(echo).not.toBeNull();
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain("avant ton objectif pendant un moment d'émotion");
  });

  it('early exit without negative emotion reads softer', () => {
    const echo = buildTradeCloseEcho(
      input({ exitReason: 'manual_before_target', emotionDuring: ['calm'] }),
    );
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain("avant l'objectif prévu");
  });

  it('broken plan is mirrored when the exit itself was clean', () => {
    const echo = buildTradeCloseEcho(input({ planRespected: false, exitReason: 'tp_hit' }));
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain('hors plan');
  });

  it('a declared management miss is mirrored (S26 acts)', () => {
    const echo = buildTradeCloseEcho(input({ movedToBe: false }));
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain('gestion');
  });

  it('a clean loss is framed as a normal cost (Douglas), tone ok', () => {
    const echo = buildTradeCloseEcho(input({ outcome: 'loss', exitReason: 'sl_hit' }));
    expect(echo?.tone).toBe('ok');
    expect(echo?.lines[0]?.toLowerCase()).toContain('perte');
  });

  it('null self-reports NEVER fabricate a miss (all-null close stays clean)', () => {
    const echo = buildTradeCloseEcho(input({ outcome: 'break_even' }));
    expect(echo?.tone).toBe('ok');
    expect(echo?.lines[0]?.toLowerCase()).toContain('break-even');
  });
});

describe('buildTradeCloseEcho — follow-up + anchor lines', () => {
  it('a WIN carrying a process miss gets the winning-bad-trade follow-up', () => {
    const echo = buildTradeCloseEcho(input({ outcome: 'win', processComplete: false }));
    expect(echo?.lines).toHaveLength(2);
    expect(echo?.lines[1]).toContain("n'efface pas le geste");
  });

  it('an open discrepancy on the trade adds the verification pointer', () => {
    const echo = buildTradeCloseEcho(input({ outcome: 'loss', openDiscrepancyCount: 1 }));
    expect(echo?.lines[1]).toContain('écart de vérification');
  });

  it('the learning stage closes the echo, capped at 3 lines total', () => {
    const echo = buildTradeCloseEcho(
      input({
        outcome: 'win',
        processComplete: false,
        openDiscrepancyCount: 2, // dropped: win-but-broken outranks it
        learningStage: 'mechanical',
      }),
    );
    expect(echo?.lines).toHaveLength(3);
    expect(echo?.lines[2]).toContain('respect strict de tes règles');
  });
});

describe('buildTradeCloseEcho — register personalisation', () => {
  it('the socratique register phrases the SAME signal as a question', () => {
    const base = input({ exitReason: 'manual_before_target', emotionDuring: ['fear-wrong'] });
    const pedagogique = buildTradeCloseEcho(base);
    const socratique = buildTradeCloseEcho({ ...base, coachingRegister: 'socratique' });
    expect(pedagogique?.lines[0]).not.toBe(socratique?.lines[0]);
    expect(socratique?.lines[0]?.trim().endsWith('?')).toBe(true);
  });

  it('defaults to the pedagogique register when the profile is absent', () => {
    const anonymous = buildTradeCloseEcho(input({ planRespected: false }));
    const explicit = buildTradeCloseEcho(
      input({ planRespected: false, coachingRegister: 'pedagogique' }),
    );
    expect(anonymous?.lines[0]).toBe(explicit?.lines[0]);
  });
});

describe('echoProfileDims', () => {
  it('degrades garbage/legacy profile blobs to nulls (never fabricates)', () => {
    expect(echoProfileDims(null)).toEqual({ coachingRegister: null, learningStage: null });
    expect(echoProfileDims({ coachingTone: 'direct', learningStage: 42 })).toEqual({
      coachingRegister: null,
      learningStage: null,
    });
  });

  it('extracts the two enums from valid dimension blobs', () => {
    const evidence = ['Je veux des retours cash, sans détour.'];
    const dims = echoProfileDims({
      coachingTone: { register: 'direct', rationale: 'Préférence exprimée clairement.', evidence },
      learningStage: { stage: 'subjective', rationale: 'Lecture en construction.', evidence },
    });
    expect(dims).toEqual({ coachingRegister: 'direct', learningStage: 'subjective' });
  });
});

describe('buildTradeCloseEcho — Tour 11 anti-tilt loss-streak follow-up', () => {
  const lossStreak = (overrides: Partial<TradeCloseEchoInput> = {}) =>
    input({ outcome: 'loss', exitReason: 'sl_hit', ...overrides });

  it('adds the streak line once the run reaches the threshold on a loss', () => {
    const echo = buildTradeCloseEcho(
      lossStreak({ recentConsecutiveLosses: LOSS_STREAK_ECHO_THRESHOLD }),
    );
    expect(echo?.lines).toHaveLength(2);
    expect(echo?.lines[1]).toContain("perte d'affilée");
    expect(echo?.lines[1]).toContain('variance normale');
    // Never punitive / never a countdown: tone follows the clean-loss reading.
    expect(echo?.tone).toBe('ok');
  });

  it('stays silent below the threshold', () => {
    const echo = buildTradeCloseEcho(
      lossStreak({ recentConsecutiveLosses: LOSS_STREAK_ECHO_THRESHOLD - 1 }),
    );
    expect(echo?.lines).toHaveLength(1);
  });

  it('stays silent when recentConsecutiveLosses is absent (legacy caller)', () => {
    const echo = buildTradeCloseEcho(lossStreak());
    expect(echo?.lines).toHaveLength(1);
  });

  it('never fires on a win, even with a stale streak count passed', () => {
    const echo = buildTradeCloseEcho(
      input({ outcome: 'win', recentConsecutiveLosses: 5, processComplete: false }),
    );
    // Win keeps the winning-bad-trade follow-up, never a loss-streak line.
    expect(echo?.lines.some((l) => l.includes("perte d'affilée"))).toBe(false);
    expect(echo?.lines[1]).toContain("n'efface pas le geste");
  });

  it('outranks the open-discrepancy pointer (one follow-up slot, streak wins)', () => {
    const echo = buildTradeCloseEcho(
      lossStreak({ recentConsecutiveLosses: 4, openDiscrepancyCount: 2 }),
    );
    expect(echo?.lines).toHaveLength(2);
    expect(echo?.lines[1]).toContain("perte d'affilée");
    expect(echo?.lines.some((l) => l.includes('écart de vérification'))).toBe(false);
  });

  it('phrases the streak line by register (socratique ends on a question)', () => {
    const base = lossStreak({ recentConsecutiveLosses: 3 });
    const pedagogique = buildTradeCloseEcho(base);
    const socratique = buildTradeCloseEcho({ ...base, coachingRegister: 'socratique' });
    expect(pedagogique?.lines[1]).not.toBe(socratique?.lines[1]);
    expect(socratique?.lines[1]?.trim().endsWith('?')).toBe(true);
  });

  it('stays capped at 3 lines with the stage anchor', () => {
    const echo = buildTradeCloseEcho(
      lossStreak({ recentConsecutiveLosses: 3, learningStage: 'mechanical' }),
    );
    expect(echo?.lines).toHaveLength(3);
    expect(echo?.lines[1]).toContain("perte d'affilée");
    expect(echo?.lines[2]).toContain('respect strict de tes règles');
  });
});

describe('buildTradeOpenEcho — Tour 11 finding 1 (open engagement echo)', () => {
  function openInput(overrides: Partial<TradeOpenEchoInput> = {}): TradeOpenEchoInput {
    return {
      openedAt: FRESH_CLOSE, // 6h ago — inside the window
      planRespected: true,
      emotionBefore: ['calm'],
      hasStopLoss: true,
      learningStage: null,
      coachingRegister: null,
      now: NOW,
      ...overrides,
    };
  }

  it('returns null for a trade with no open instant', () => {
    expect(buildTradeOpenEcho(openInput({ openedAt: null }))).toBeNull();
  });

  it('returns null once the open is older than the window', () => {
    const stale = new Date(NOW.getTime() - (ECHO_WINDOW_HOURS + 1) * 60 * 60 * 1000).toISOString();
    expect(buildTradeOpenEcho(openInput({ openedAt: stale }))).toBeNull();
  });

  it('returns null on a malformed openedAt instead of throwing', () => {
    expect(buildTradeOpenEcho(openInput({ openedAt: 'not-a-date' }))).toBeNull();
  });

  it('off-plan entry is mirrored first, calm watch tone (never red)', () => {
    const echo = buildTradeOpenEcho(
      openInput({ planRespected: false, emotionBefore: ['fear-loss'], hasStopLoss: false }),
    );
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain('hors plan');
  });

  it('a tense in-plan entry reads as a calm watch, never accusatory', () => {
    const echo = buildTradeOpenEcho(openInput({ emotionBefore: ['anxious'] }));
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]).toContain('tension');
  });

  it('a clean in-plan entry with a stop is acknowledged (ok tone)', () => {
    const echo = buildTradeOpenEcho(openInput());
    expect(echo?.tone).toBe('ok');
    // Default register is pedagogique: acknowledges an in-plan entry with a stop.
    expect(echo?.lines[0]).toContain('dans le plan');
    expect(echo?.lines[0]?.toLowerCase()).toContain('stop');
  });

  it('a clean in-plan entry WITHOUT a stop nudges toward a stop (watch, not red)', () => {
    const echo = buildTradeOpenEcho(openInput({ hasStopLoss: false }));
    expect(echo?.tone).toBe('watch');
    expect(echo?.lines[0]?.toLowerCase()).toContain('stop');
  });

  it('appends the stage anchor when the profile carries a stage (max 2 lines)', () => {
    const echo = buildTradeOpenEcho(openInput({ learningStage: 'intuitive' }));
    expect(echo?.lines).toHaveLength(2);
    expect(echo?.lines[1]).toContain('constance');
  });

  it('phrases the same signal by register (socratique ends on a question)', () => {
    const base = openInput({ planRespected: false });
    const pedagogique = buildTradeOpenEcho(base);
    const socratique = buildTradeOpenEcho({ ...base, coachingRegister: 'socratique' });
    expect(pedagogique?.lines[0]).not.toBe(socratique?.lines[0]);
    expect(socratique?.lines[0]?.trim().endsWith('?')).toBe(true);
  });

  it('defaults to the pedagogique register when the profile is absent', () => {
    const anonymous = buildTradeOpenEcho(openInput({ planRespected: false }));
    const explicit = buildTradeOpenEcho(
      openInput({ planRespected: false, coachingRegister: 'pedagogique' }),
    );
    expect(anonymous?.lines[0]).toBe(explicit?.lines[0]);
  });
});
