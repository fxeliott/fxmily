import { describe, expect, it } from 'vitest';

import { mergeNotes } from './notes';

describe('mergeNotes', () => {
  it('returns prior unchanged when addition is undefined', () => {
    expect(mergeNotes('Setup propre.', undefined)).toBe('Setup propre.');
  });

  it('returns prior unchanged when addition is empty', () => {
    expect(mergeNotes('Setup propre.', '')).toBe('Setup propre.');
  });

  it('returns prior null when addition is undefined', () => {
    expect(mergeNotes(null, undefined)).toBeNull();
  });

  it('returns addition when prior is null', () => {
    expect(mergeNotes(null, 'TP atteint.')).toBe('TP atteint.');
  });

  it('returns addition when prior is empty string', () => {
    expect(mergeNotes('', 'TP atteint.')).toBe('TP atteint.');
  });

  it('joins prior + addition with the section delimiter', () => {
    const merged = mergeNotes('Setup propre.', 'TP atteint, discipline OK.');
    expect(merged).toBe('Setup propre.\n\n--- Sortie ---\nTP atteint, discipline OK.');
  });

  it('preserves multiline pre-entry notes', () => {
    const prior = 'Setup propre.\nContexte fort.';
    const merged = mergeNotes(prior, 'Sortie cleean.');
    expect(merged).toBe(`${prior}\n\n--- Sortie ---\nSortie cleean.`);
  });

  it('does not insert the delimiter twice if called repeatedly', () => {
    // First close-out (from a hypothetical edit flow that re-runs the merge)
    const once = mergeNotes('A', 'B');
    expect(once).toBe('A\n\n--- Sortie ---\nB');
    // A second call with empty addition is a no-op.
    expect(mergeNotes(once, '')).toBe(once);
  });
});
