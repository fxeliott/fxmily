import { describe, expect, it } from 'vitest';

import {
  TRAINING_SESSION_LABEL_MAX,
  TRAINING_SESSION_NOTES_MAX,
  TRAINING_SESSION_TIMEFRAME_MAX,
  trainingSessionCreateSchema,
  trainingSessionIdSchema,
} from './training-session';

/**
 * S8 Mode Entraînement — schema-level tests for the backtest-SESSION container.
 * Pure Zod (no IO, no mocks). The Server Action branching + statistical-isolation
 * contract live in `app/training/sessions/actions.test.ts`; here we exercise the
 * field BOUNDARIES and the Trojan-Source hardening that the action test only
 * spot-checks. Mirrors `training-trade.test.ts` / `training-annotation.test.ts`.
 */

/** A fully-valid session payload; override one field per test. */
function valid(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Backtest GBPUSD — range janvier',
    symbol: 'GBPUSD',
    timeframe: 'H4',
    notes: 'Replay du range, entrées patientes.',
    ...overrides,
  };
}

describe('trainingSessionCreateSchema', () => {
  it('accepts a fully-valid session', () => {
    expect(trainingSessionCreateSchema.safeParse(valid()).success).toBe(true);
  });

  // ----- symbol (allowlisted uppercase pair, mirror Trade.pair) -----

  it('uppercases a lowercase symbol', () => {
    const parsed = trainingSessionCreateSchema.parse(valid({ symbol: 'gbpusd' }));
    expect(parsed.symbol).toBe('GBPUSD');
  });

  it('rejects a symbol not in the TRADING_PAIRS allowlist', () => {
    expect(trainingSessionCreateSchema.safeParse(valid({ symbol: 'NOTAPAIR' })).success).toBe(
      false,
    );
  });

  // ----- timeframe (short alnum free token) -----

  it('uppercases and accepts a valid alphanumeric timeframe', () => {
    const parsed = trainingSessionCreateSchema.parse(valid({ timeframe: 'h4' }));
    expect(parsed.timeframe).toBe('H4');
  });

  it('rejects a non-alphanumeric timeframe', () => {
    expect(trainingSessionCreateSchema.safeParse(valid({ timeframe: 'H4!' })).success).toBe(false);
  });

  it('rejects a timeframe over the length cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ timeframe: 'A'.repeat(TRAINING_SESSION_TIMEFRAME_MAX + 1) }),
      ).success,
    ).toBe(false);
  });

  it('accepts a timeframe exactly at the length cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ timeframe: 'A'.repeat(TRAINING_SESSION_TIMEFRAME_MAX) }),
      ).success,
    ).toBe(true);
  });

  // ----- label / notes (optionalHardenedText: trim + NFC + Trojan-Source) -----

  it('trims and NFC-normalizes the label', () => {
    const parsed = trainingSessionCreateSchema.parse(valid({ label: '   mon backtest  \n  ' }));
    expect(parsed.label).toBe('mon backtest');
  });

  it('preserves internal newlines in the notes', () => {
    const parsed = trainingSessionCreateSchema.parse(valid({ notes: 'Point 1.\n\nPoint 2.' }));
    expect(parsed.notes).toBe('Point 1.\n\nPoint 2.');
  });

  it('rejects a label with a bidi override (U+202E, Trojan-Source)', () => {
    expect(trainingSessionCreateSchema.safeParse(valid({ label: 'note‮evil' })).success).toBe(
      false,
    );
  });

  it('rejects notes with a zero-width space (U+200B)', () => {
    expect(trainingSessionCreateSchema.safeParse(valid({ notes: 'hid​den' })).success).toBe(false);
  });

  it('rejects a label over the cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ label: 'a'.repeat(TRAINING_SESSION_LABEL_MAX + 1) }),
      ).success,
    ).toBe(false);
  });

  it('accepts a label exactly at the cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ label: 'a'.repeat(TRAINING_SESSION_LABEL_MAX) }),
      ).success,
    ).toBe(true);
  });

  it('rejects notes over the cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ notes: 'a'.repeat(TRAINING_SESSION_NOTES_MAX + 1) }),
      ).success,
    ).toBe(false);
  });

  it('accepts notes exactly at the cap', () => {
    expect(
      trainingSessionCreateSchema.safeParse(
        valid({ notes: 'a'.repeat(TRAINING_SESSION_NOTES_MAX) }),
      ).success,
    ).toBe(true);
  });

  it('maps an all-empty payload to all-null fields', () => {
    const parsed = trainingSessionCreateSchema.parse({
      label: '   ',
      symbol: '',
      timeframe: '  \n ',
      notes: undefined,
    });
    expect(parsed).toEqual({ label: null, symbol: null, timeframe: null, notes: null });
  });
});

describe('trainingSessionIdSchema', () => {
  it('accepts a cuid of exactly 20 chars (lower bound)', () => {
    expect(trainingSessionIdSchema.safeParse('a'.repeat(20)).success).toBe(true);
  });

  it('accepts a cuid of exactly 40 chars (upper bound)', () => {
    expect(trainingSessionIdSchema.safeParse('a'.repeat(40)).success).toBe(true);
  });

  it('rejects a cuid of 19 chars (just under the lower bound)', () => {
    expect(trainingSessionIdSchema.safeParse('a'.repeat(19)).success).toBe(false);
  });

  it('rejects a cuid of 41 chars (just over the upper bound)', () => {
    expect(trainingSessionIdSchema.safeParse('a'.repeat(41)).success).toBe(false);
  });

  it('rejects a malformed id (illegal characters)', () => {
    expect(trainingSessionIdSchema.safeParse('nope!!').success).toBe(false);
  });

  it('transforms an empty string to null (standalone backtest)', () => {
    expect(trainingSessionIdSchema.parse('')).toBe(null);
  });
});
