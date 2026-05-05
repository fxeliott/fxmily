import { describe, expect, it } from 'vitest';

import { EMOTION_MAX_PER_MOMENT, EMOTION_TAGS, emotionLabel, isEmotionSlug } from './emotions';

describe('EMOTION_TAGS', () => {
  it('contains 15 distinct tags', () => {
    expect(EMOTION_TAGS).toHaveLength(15);
    const slugs = EMOTION_TAGS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('includes the four Mark Douglas core fears', () => {
    const fearSlugs = EMOTION_TAGS.filter((t) => t.cluster === 'douglas-fears').map((t) => t.slug);
    expect(fearSlugs).toEqual(
      expect.arrayContaining(['fear-loss', 'fear-wrong', 'fomo', 'fear-leaving-money']),
    );
    expect(fearSlugs).toHaveLength(4);
  });

  it('uses kebab-case slugs without whitespace', () => {
    for (const tag of EMOTION_TAGS) {
      expect(tag.slug).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    }
  });

  it('uses non-empty FR labels', () => {
    for (const tag of EMOTION_TAGS) {
      expect(tag.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isEmotionSlug', () => {
  it('accepts every defined slug', () => {
    for (const tag of EMOTION_TAGS) {
      expect(isEmotionSlug(tag.slug)).toBe(true);
    }
  });

  it('rejects unknown / malformed values', () => {
    expect(isEmotionSlug('panic')).toBe(false);
    expect(isEmotionSlug('FEAR-LOSS')).toBe(false);
    expect(isEmotionSlug('')).toBe(false);
    expect(isEmotionSlug('peur de perdre')).toBe(false);
  });
});

describe('emotionLabel', () => {
  it('returns the FR label for a known slug', () => {
    expect(emotionLabel('fomo')).toBe('FOMO');
    expect(emotionLabel('calm')).toBe('Calme');
  });

  it('echoes back the raw slug for an unknown one (safe fallback)', () => {
    expect(emotionLabel('something-removed-later')).toBe('something-removed-later');
  });
});

describe('EMOTION_MAX_PER_MOMENT', () => {
  it('caps the picker at 3 simultaneous tags', () => {
    expect(EMOTION_MAX_PER_MOMENT).toBe(3);
  });
});
