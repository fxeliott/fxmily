/**
 * SPEC §2 posture invariant — static card corpus validation.
 *
 * For every Mark Douglas card in the seed, concatenates all member-facing
 * text fields and asserts that the AMF violation detector returns
 * `suspected: false`. With the corrected patterns (élision/quoted/TP-label
 * carve-outs), all 51 cards must pass clean.
 *
 * If a card is added in the future that genuinely contains market advice,
 * this test will surface it immediately — preventing a rogue admin entry
 * from bypassing the §2 invariant.
 */

import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';
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
// §2 posture test — all 51 cards must be clean
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
