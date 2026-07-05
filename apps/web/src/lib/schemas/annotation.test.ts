import { describe, expect, it } from 'vitest';

import { ANNOTATION_COMMENT_MAX, annotationCreateSchema } from './annotation';

const VALID_TV_URL = `https://fr.tradingview.com/x/${'a'.repeat(12)}/`;

describe('annotationCreateSchema', () => {
  it('accepts a comment-only annotation', () => {
    const result = annotationCreateSchema.safeParse({ comment: 'Bon plan respecté.' });
    expect(result.success).toBe(true);
  });

  it('trims the comment', () => {
    const parsed = annotationCreateSchema.parse({ comment: '   discipline 👍   ' });
    expect(parsed.comment).toBe('discipline 👍');
  });

  it('rejects an empty comment', () => {
    const result = annotationCreateSchema.safeParse({ comment: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only comment', () => {
    const result = annotationCreateSchema.safeParse({ comment: '   \n  ' });
    expect(result.success).toBe(false);
  });

  it('rejects a comment over the cap', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'a'.repeat(ANNOTATION_COMMENT_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  // ----- Tour 13 — optional TradingView link (replaces the upload pair) -----

  it('accepts a comment + valid TradingView link', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'Cf. analyse jointe.',
      tradingViewUrl: VALID_TV_URL,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tradingViewUrl).toBe(VALID_TV_URL);
  });

  it('rejects a malformed TradingView link (not a URL)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      tradingViewUrl: 'not a url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('tradingViewUrl');
    }
  });

  it('rejects an off-host link (host not on the tradingview.com allowlist)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      tradingViewUrl: 'https://evil.example.com/x/abc/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-HTTPS TradingView link', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      tradingViewUrl: 'http://fr.tradingview.com/x/abc/',
    });
    expect(result.success).toBe(false);
  });

  it('no longer accepts a mediaKey/mediaType pair on create (legacy read-only)', () => {
    // mediaKey/mediaType are stripped from the create schema; unknown keys are
    // simply ignored, so the parse still succeeds on the comment alone and the
    // resolved data carries NO media fields.
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: `annotations/clx0abc123/${'a'.repeat(32)}.jpg`,
      mediaType: 'image',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('mediaKey');
      expect(result.data).not.toHaveProperty('mediaType');
    }
  });

  // SPEC §2 posture invariant — the admin comment is member-facing and must be
  // held to the same no-market-advice gate as Mark Douglas cards and the IA
  // surfaces (`detectAMFViolation`). These lock the guardrail so removing it
  // turns CI red.
  it('rejects a comment that gives a market-direction call (§2)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'Short le DAX maintenant, vise les 1.15.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('comment');
    }
  });

  it('rejects a comment that gives a price target / take profit (§2)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'Place ton take profit à 1.0850 et ton stop sous le support.',
    });
    expect(result.success).toBe(false);
  });

  it('still accepts legitimate execution + psychology coaching (§2 must-not-flag)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'Bon respect de ton plan. Reste discipliné sur tes horaires de session.',
    });
    expect(result.success).toBe(true);
  });
});
