/**
 * SPEC §2 posture invariant — static card corpus validation.
 *
 * For every Mark Douglas card in the seed, concatenates all member-facing
 * text fields and asserts that the AMF violation detector returns
 * `suspected: false`. With the corrected patterns (élision/quoted/TP-label
 * carve-outs), all 54 cards must pass clean.
 *
 * If a card is added in the future that genuinely contains market advice,
 * this test will surface it immediately — preventing a rogue admin entry
 * from bypassing the §2 invariant.
 */

import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { cardCreateSchema } from '@/lib/schemas/card';
import { MARK_DOUGLAS_CARDS_SEED } from '../../../scripts/data/cards';

// =============================================================================
// Helper — build member-facing corpus from a card
// =============================================================================

/**
 * Concatenates every text field visible to the member:
 *   title, quote, paraphrase, exercises[].label, exercises[].description
 *
 * The `quoteSourceChapter` is attribution metadata, not member-facing coaching
 * content — excluded to match what the member actually reads.
 */
function cardCorpus(card: (typeof MARK_DOUGLAS_CARDS_SEED)[number]): string {
  const parts: string[] = [card.title, card.quote, card.paraphrase];

  for (const ex of card.exercises) {
    parts.push(ex.label, ex.description);
  }

  return parts.join('\n\n');
}

// =============================================================================
// FIX F — catalogue category regression guard (DoD#2 alert-S3→coaching path)
//
// Asserts that the seed catalogue has ≥1 published card in 'discipline' and
// ≥1 in 'ego'. Without this, the alert-S3→coaching dispatch (DoD#2) would
// silently have no eligible card to deliver for those psychological categories.
// Pure test — zero prod code changed.
// =============================================================================

describe('Mark Douglas cards — catalogue category regression guard (FIX F S5)', () => {
  it('has at least 1 published card in category "discipline"', () => {
    const disciplineCards = MARK_DOUGLAS_CARDS_SEED.filter(
      (c) => c.published === true && c.category === 'discipline',
    );
    expect(disciplineCards.length).toBeGreaterThanOrEqual(1);
  });

  it('has at least 1 published card in category "ego"', () => {
    const egoCards = MARK_DOUGLAS_CARDS_SEED.filter(
      (c) => c.published === true && c.category === 'ego',
    );
    expect(egoCards.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// §2 posture test — all 54 cards must be clean
// =============================================================================

describe('Mark Douglas cards — SPEC §2 posture invariant', () => {
  for (const card of MARK_DOUGLAS_CARDS_SEED) {
    it(`card "${card.slug}" does not violate §2`, () => {
      const corpus = cardCorpus(card);
      const result = detectAMFViolation(corpus);
      expect(
        result.suspected,
        `card ${card.slug} viole §2: ${result.matchedLabels.join(', ')}`,
      ).toBe(false);
    });
  }
});

// =============================================================================
// FULL SCHEMA gate — S5 13e challenge.
//
// The §2 test above only runs `detectAMFViolation`; it does NOT enforce the
// rest of `cardCreateSchema` (quote ≤30 mots fair-use, lengths, structure).
// The dedicated `scripts/validate-cards.ts` gate was dead (card.ts crashed at
// import on `.partial()`), so a 31-word quote slipped into the seed unnoticed.
// This validates EVERY seed card against the FULL `cardCreateSchema` in CI →
// word-count / structure / §2 can never silently drift again.
// =============================================================================

describe('Mark Douglas cards — full cardCreateSchema validation (S5 13e)', () => {
  for (const card of MARK_DOUGLAS_CARDS_SEED) {
    it(`card "${card.slug}" satisfies cardCreateSchema (incl. quote ≤30 mots)`, () => {
      const result = cardCreateSchema.safeParse(card);
      expect(
        result.success,
        result.success
          ? ''
          : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | '),
      ).toBe(true);
    });
  }
});
