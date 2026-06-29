import { describe, expect, it } from 'vitest';

import { ANNOTATION_COMMENT_MAX, annotationCreateSchema } from './annotation';

const VALID_KEY = `annotations/clx0abc123/${'a'.repeat(32)}.jpg`;

describe('annotationCreateSchema', () => {
  it('accepts a comment-only annotation', () => {
    const result = annotationCreateSchema.safeParse({ comment: 'Bon plan respecté.' });
    expect(result.success).toBe(true);
  });

  it('accepts a comment + image media pair', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'Cf. capture annotée.',
      mediaKey: VALID_KEY,
      mediaType: 'image',
    });
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

  it('rejects mediaKey without mediaType', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: VALID_KEY,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('mediaKey');
    }
  });

  it('rejects mediaType without mediaKey', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaType: 'image',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed media key (path traversal)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: 'annotations/../../etc/passwd',
      mediaType: 'image',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a trade-prefixed key for an annotation', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: `trades/clx0abc123/${'a'.repeat(32)}.jpg`,
      mediaType: 'image',
    });
    expect(result.success).toBe(false);
  });

  it('rejects gif extension (not in the allowlist)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: `annotations/clx0abc123/${'a'.repeat(32)}.gif`,
      mediaType: 'image',
    });
    expect(result.success).toBe(false);
  });

  it('rejects video mediaType (deferred to J4.5)', () => {
    const result = annotationCreateSchema.safeParse({
      comment: 'ok',
      mediaKey: `annotations/clx0abc123/${'a'.repeat(32)}.jpg`,
      mediaType: 'video',
    });
    expect(result.success).toBe(false);
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
