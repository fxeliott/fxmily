import { describe, expect, it } from 'vitest';

import { buildPreTradeEcho, type PreTradeEchoInput } from './pre-trade-echo';

/**
 * Tour 11 — decision table of the living pre-trade echo. Pure module: each case
 * pins the SELECTED signal (priority order), the tone and register variation,
 * never the full prose.
 */

function input(overrides: Partial<PreTradeEchoInput> = {}): PreTradeEchoInput {
  return {
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    coachingRegister: null,
    ...overrides,
  };
}

describe('buildPreTradeEcho — signal priority', () => {
  it('a missing stop-loss wins over everything (tone watch)', () => {
    const echo = buildPreTradeEcho(
      input({ stopLossPredefined: false, planAlignment: false, reasonToTrade: 'revenge' }),
    );
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('stop-loss');
  });

  it('an unaligned plan is mirrored when the stop is defined', () => {
    const echo = buildPreTradeEcho(input({ planAlignment: false, reasonToTrade: 'fomo' }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('plan');
  });

  it('a non-edge reason is mirrored when stop + plan are fine', () => {
    const echo = buildPreTradeEcho(input({ reasonToTrade: 'fomo' }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('edge');
  });

  it('a charged emotion is mirrored last', () => {
    const echo = buildPreTradeEcho(input({ emotionLabel: 'anxieux' }));
    expect(echo.tone).toBe('watch');
    expect(echo.lines[0]?.toLowerCase()).toContain('chargé');
  });

  it('a fully aligned pause reads as calm reinforcement (tone ok)', () => {
    const echo = buildPreTradeEcho(input());
    expect(echo.tone).toBe('ok');
    expect(echo.lines).toHaveLength(1);
  });

  it('boredom counts as a non-edge reason', () => {
    const echo = buildPreTradeEcho(input({ reasonToTrade: 'boredom' }));
    expect(echo.tone).toBe('watch');
  });

  it('excite is a positive-valence state, not a charged one', () => {
    const echo = buildPreTradeEcho(input({ emotionLabel: 'excite' }));
    expect(echo.tone).toBe('ok');
  });
});

describe('buildPreTradeEcho — personalisation', () => {
  it('the socratique register phrases the SAME signal as a question', () => {
    const base = input({ stopLossPredefined: false });
    const pedago = buildPreTradeEcho(base);
    const socra = buildPreTradeEcho({ ...base, coachingRegister: 'socratique' });
    expect(pedago.lines[0]).not.toBe(socra.lines[0]);
    expect(socra.lines[0]?.trim().endsWith('?')).toBe(true);
  });

  it('defaults to pedagogique when the profile is absent', () => {
    const anon = buildPreTradeEcho(input({ planAlignment: false }));
    const explicit = buildPreTradeEcho(
      input({ planAlignment: false, coachingRegister: 'pedagogique' }),
    );
    expect(anon.lines[0]).toBe(explicit.lines[0]);
  });
});
