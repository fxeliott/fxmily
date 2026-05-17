import { describe, expect, it } from 'vitest';

import {
  TRAINING_ANNOTATION_COMMENT_MAX,
  trainingAnnotationCreateSchema,
} from './training-annotation';

const KEY = 'training_annotations/abcdefgh12345678/abcdefghijkl1234.png';

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

  // ----- media key + type pairing (mirror annotation.ts superRefine) -----

  it('accepts comment + valid mediaKey + mediaType together', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'Voir capture annotée.',
        mediaKey: KEY,
        mediaType: 'image',
      }).success,
    ).toBe(true);
  });

  it('rejects a mediaKey without a mediaType', () => {
    expect(trainingAnnotationCreateSchema.safeParse({ comment: 'x', mediaKey: KEY }).success).toBe(
      false,
    );
  });

  it('rejects a mediaType without a mediaKey', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({ comment: 'x', mediaType: 'image' }).success,
    ).toBe(false);
  });

  it('rejects a malformed / foreign-prefix mediaKey', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'x',
        mediaKey: 'annotations/abcdefgh12345678/abcdefghijkl1234.png',
        mediaType: 'image',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown mediaType', () => {
    expect(
      trainingAnnotationCreateSchema.safeParse({
        comment: 'x',
        mediaKey: KEY,
        mediaType: 'video',
      }).success,
    ).toBe(false);
  });
});
