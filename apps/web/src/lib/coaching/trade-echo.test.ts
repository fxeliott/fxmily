import { describe, expect, it } from 'vitest';

import {
  buildTradeCloseEcho,
  echoProfileDims,
  ECHO_WINDOW_HOURS,
  type TradeCloseEchoInput,
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
