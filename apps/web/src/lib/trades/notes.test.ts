import { describe, expect, it } from 'vitest';

import { mergeNotes, splitNotes } from './notes';

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

describe('splitNotes', () => {
  it('returns all-null on null / empty input', () => {
    expect(splitNotes(null)).toEqual({
      entry: null,
      debrief: null,
      raw: null,
      hasSections: false,
    });
    expect(splitNotes('')).toEqual({ entry: null, debrief: null, raw: null, hasSections: false });
    expect(splitNotes(undefined)).toEqual({
      entry: null,
      debrief: null,
      raw: null,
      hasSections: false,
    });
  });

  it('round-trips a merged note back into entry + debrief', () => {
    const merged = mergeNotes('Setup propre.', 'TP atteint, discipline OK.');
    expect(splitNotes(merged)).toEqual({
      entry: 'Setup propre.',
      debrief: 'TP atteint, discipline OK.',
      raw: null,
      hasSections: true,
    });
  });

  it('preserves multiline moments across the split', () => {
    const prior = 'Setup propre.\nContexte fort.';
    const merged = mergeNotes(prior, 'Sortie clean.');
    const split = splitNotes(merged);
    expect(split.entry).toBe(prior);
    expect(split.debrief).toBe('Sortie clean.');
    expect(split.hasSections).toBe(true);
  });

  it('treats a delimiter-less note as raw (no fabricated avant/après label)', () => {
    // mergeNotes(prior, undefined) → a pre-entry-only note has no delimiter.
    expect(splitNotes('Juste mon plan.')).toEqual({
      entry: null,
      debrief: null,
      raw: 'Juste mon plan.',
      hasSections: false,
    });
  });

  it('nulls an empty section when one side of the delimiter is blank', () => {
    // Defensive: a stored note that begins with the delimiter (empty entry).
    const split = splitNotes('\n\n--- Sortie ---\nUniquement le débrief.');
    expect(split.entry).toBeNull();
    expect(split.debrief).toBe('Uniquement le débrief.');
    expect(split.hasSections).toBe(true);
  });
});
