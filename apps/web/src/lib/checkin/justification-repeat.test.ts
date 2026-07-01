import { describe, expect, it } from 'vitest';

import {
  detectRepeatedJustifications,
  type JustificationRepeatInput,
  normalizeJustification,
} from './justification-repeat';

/**
 * F7 §33.2 — deterministic rattrapage-justification redundancy signal.
 * These pin the fold (accent/case/punctuation-insensitive) and the windowed
 * reuse detection. NOT a lie detector — only reuse of the same wording.
 */

describe('normalizeJustification', () => {
  it('folds accents, lowercases, and collapses punctuation/whitespace', () => {
    expect(normalizeJustification('Panne internet, hier soir !')).toBe('panne internet hier soir');
    expect(normalizeJustification('  PANNE   internet  ')).toBe('panne internet');
    // Accent-insensitive: « à l'hôpital » folds to the same key as « a l hopital ».
    expect(normalizeJustification("Journée à l'hôpital")).toBe('journee a l hopital');
  });

  it('returns an empty string when nothing meaningful remains', () => {
    expect(normalizeJustification('   ')).toBe('');
    expect(normalizeJustification('!!! ??? ...')).toBe('');
  });

  it('matches two spellings of the same reason after folding', () => {
    expect(normalizeJustification('Panne internet, hier soir !')).toBe(
      normalizeJustification('panne  INTERNET hier soir'),
    );
  });
});

function backfill(
  id: string,
  at: string | null,
  justification: string | null,
): JustificationRepeatInput {
  return { id, backfilledAt: at, lateJustification: justification };
}

describe('detectRepeatedJustifications', () => {
  it('flags two backfills reusing the same wording within the window', () => {
    const map = detectRepeatedJustifications([
      backfill('a', '2026-06-05T09:00:00.000Z', 'Panne internet.'),
      backfill('b', '2026-06-10T09:00:00.000Z', 'panne internet'),
    ]);
    expect(map.get('a')).toBe(2);
    expect(map.get('b')).toBe(2);
  });

  it('does NOT flag distinct justifications', () => {
    const map = detectRepeatedJustifications([
      backfill('a', '2026-06-05T09:00:00.000Z', 'Panne internet.'),
      backfill('b', '2026-06-06T09:00:00.000Z', "Journée à l'hôpital."),
    ]);
    expect(map.size).toBe(0);
  });

  it('does NOT flag the same wording reused outside the 14-day window', () => {
    const map = detectRepeatedJustifications([
      backfill('a', '2026-06-05T09:00:00.000Z', 'Panne internet.'),
      backfill('b', '2026-06-25T09:00:00.000Z', 'Panne internet.'), // 20 days later
    ]);
    expect(map.size).toBe(0);
  });

  it('counts three reuses within the window as 3', () => {
    const map = detectRepeatedJustifications([
      backfill('a', '2026-06-05T09:00:00.000Z', 'Oubli.'),
      backfill('b', '2026-06-08T09:00:00.000Z', 'oubli'),
      backfill('c', '2026-06-12T09:00:00.000Z', 'OUBLI !'),
    ]);
    expect(map.get('a')).toBe(3);
    expect(map.get('b')).toBe(3);
    expect(map.get('c')).toBe(3);
  });

  it('ignores on-time check-ins and empty justifications', () => {
    const map = detectRepeatedJustifications([
      // On-time (no backfilledAt) — never a rattrapage, ignored.
      backfill('ontime', null, 'Panne internet.'),
      backfill('a', '2026-06-05T09:00:00.000Z', 'Panne internet.'),
      // Empty-after-fold justification — never flagged.
      backfill('blank', '2026-06-06T09:00:00.000Z', '!!!'),
    ]);
    // Only one real backfill with this wording → below threshold → nothing.
    expect(map.size).toBe(0);
  });
});
