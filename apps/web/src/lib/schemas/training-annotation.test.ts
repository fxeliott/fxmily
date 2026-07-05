import { describe, expect, it } from 'vitest';

import {
  TRAINING_ANNOTATION_COMMENT_MAX,
  trainingAnnotationCreateSchema,
} from './training-annotation';

const VALID_TV_URL = `https://fr.tradingview.com/x/${'a'.repeat(12)}/`;

describe('trainingAnnotationCreateSchema', () => {
  it('accepts a comment-only correction', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({ comment: 'Bonne lecture du contexte.' }).success,
    ).toBe(true);
  });

  it('trims and NFC-normalizes the comment', () => {
    const parsed = trainingAnnotationCreateSchema.parse({ comment: '   revois ton SL  \n  ' });
    expect(parsed.comment).toBe('revois ton SL');
  });

  it('preserves internal newlines (multi-paragraph correction)', () => {
    const parsed = trainingAnnotationCreateSchema.parse({ comment: 'Point 1.\n\nPoint 2.' });
    expect(parsed.comment).toBe('Point 1.\n\nPoint 2.');
  });

  it('rejects an empty comment', () => {
    expect(trainingAnnotationCreateSchema.safeParse({ comment: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only comment', () => {
    expect(trainingAnnotationCreateSchema.safeParse({ comment: '   \n ' }).success).toBe(false);
  });

  it('rejects a comment over the cap', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'a'.repeat(TRAINING_ANNOTATION_COMMENT_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it('accepts a comment exactly at the cap', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'a'.repeat(TRAINING_ANNOTATION_COMMENT_MAX),
      }).success,
    ).toBe(true);
  });

  it('rejects a comment with a bidi override (U+202E, Trojan-Source)', () => {
    expect(trainingAnnotationCreateSchema.safeParse({ comment: 'fix‮evil' }).success).toBe(false);
  });

  it('rejects a comment with a zero-width space (U+200B)', () => {
    expect(trainingAnnotationCreateSchema.safeParse({ comment: 'hid​den' }).success).toBe(false);
  });

  it('rejects a missing comment field', () => {
    expect(trainingAnnotationCreateSchema.safeParse({}).success).toBe(false);
  });

  // ----- Tour 13 — optional TradingView link (replaces the upload pair) -----

  it('accepts comment + valid TradingView link', () => {
    const result = trainingAnnotationCreateSchema.safeParse({
      comment: 'Voir analyse jointe.',
      tradingViewUrl: VALID_TV_URL,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tradingViewUrl).toBe(VALID_TV_URL);
  });

  it('rejects a malformed TradingView link (not a URL)', () => {
    const result = trainingAnnotationCreateSchema.safeParse({
      comment: 'x',
      tradingViewUrl: 'not a url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('tradingViewUrl');
    }
  });

  it('rejects an off-host link (host not on the tradingview.com allowlist)', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'x',
        tradingViewUrl: 'https://evil.example.com/x/abc/',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-HTTPS TradingView link', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'x',
        tradingViewUrl: 'http://fr.tradingview.com/x/abc/',
      }).success,
    ).toBe(false);
  });

  it('no longer accepts a mediaKey/mediaType pair on create (legacy read-only)', () => {
    const result = trainingAnnotationCreateSchema.safeParse({
      comment: 'x',
      mediaKey: 'training_annotations/abcdefgh12345678/abcdefghijkl1234.png',
      mediaType: 'image',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('mediaKey');
      expect(result.data).not.toHaveProperty('mediaType');
    }
  });

  // ----- §2 posture gate (mirror annotation.ts) — admin→member text -----

  it('rejects a correction that gives a market-direction call (§2)', () => {
    const result = trainingAnnotationCreateSchema.safeParse({
      comment: 'Short le DAX maintenant, vise les 1.15.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('comment');
    }
  });

  it('rejects a correction that gives a price target (§2)', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'Place ton take profit à 1.0850.',
      }).success,
    ).toBe(false);
  });

  it('still accepts execution + psychology correction (§2 must-not-flag)', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'Bonne gestion du risque. Revois ta routine avant la session.',
      }).success,
    ).toBe(true);
  });
});
