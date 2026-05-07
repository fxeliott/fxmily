import { describe, expect, it } from 'vitest';

import { containsBidiOrZeroWidth, graphemeCount, safeFreeText } from './safe';

/**
 * Free-text safety helpers (J5 audit M5 fix). Critical before J8 ships
 * the Claude API rapport hebdo — these strings will be fed into prompts.
 */

describe('safeFreeText', () => {
  it('returns the input unchanged for plain text', () => {
    expect(safeFreeText('Une journée calme.')).toBe('Une journée calme.');
  });

  it('trims surrounding whitespace', () => {
    expect(safeFreeText('  hello  ')).toBe('hello');
  });

  it('NFC-normalizes decomposed accents (é = U+0065 + U+0301 → U+00E9)', () => {
    const decomposed = 'café'; // "café" decomposed
    const composed = 'café';
    const out = safeFreeText(decomposed);
    expect(out).toBe(composed);
    expect(out.length).toBe(4); // not 5
  });

  it('strips zero-width space (U+200B)', () => {
    expect(safeFreeText('hello​world')).toBe('helloworld');
  });

  it('strips bidi override RLO (U+202E) — Trojan Source vector', () => {
    expect(safeFreeText('user‮admin')).toBe('useradmin');
  });

  it('strips LRI / RLI / PDI (U+2066-U+2069 modern bidi controls)', () => {
    const malicious = 'visible⁦hidden⁩here';
    expect(safeFreeText(malicious)).toBe('visiblehiddenhere');
  });

  it('strips BOM (U+FEFF)', () => {
    expect(safeFreeText('﻿hello')).toBe('hello');
  });

  it('preserves regular ASCII whitespace and French punctuation', () => {
    expect(safeFreeText('Salut, ça va ? Très bien !')).toBe('Salut, ça va ? Très bien !');
  });

  it('is idempotent', () => {
    const malicious = '  café‮admin​  ';
    const once = safeFreeText(malicious);
    const twice = safeFreeText(once);
    expect(twice).toBe(once);
  });
});

describe('containsBidiOrZeroWidth', () => {
  it('returns false on plain text', () => {
    expect(containsBidiOrZeroWidth('Une journée calme.')).toBe(false);
  });

  it('returns true when a bidi control char is present', () => {
    expect(containsBidiOrZeroWidth('user‮admin')).toBe(true);
  });

  it('returns true when a zero-width space is present', () => {
    expect(containsBidiOrZeroWidth('hello​world')).toBe(true);
  });

  it('returns true on BOM', () => {
    expect(containsBidiOrZeroWidth('﻿hello')).toBe(true);
  });

  it('is stateful-safe across multiple calls (regex lastIndex reset)', () => {
    const malicious = 'a​b';
    // Call multiple times in sequence — must always return true (regex `g`
    // flag has lastIndex state that can fool naïve implementations).
    expect(containsBidiOrZeroWidth(malicious)).toBe(true);
    expect(containsBidiOrZeroWidth(malicious)).toBe(true);
    expect(containsBidiOrZeroWidth(malicious)).toBe(true);
  });
});

describe('graphemeCount', () => {
  it('counts plain ASCII characters', () => {
    expect(graphemeCount('hello')).toBe(5);
  });

  it('counts French accented characters as 1 grapheme', () => {
    expect(graphemeCount('café')).toBe(4);
  });

  it('counts a single emoji as 1 grapheme (vs String.length = 2)', () => {
    expect(graphemeCount('🔥')).toBe(1);
    expect('🔥'.length).toBe(2); // sanity check
  });

  it('counts a multi-codepoint emoji family as 1 grapheme (vs many code units)', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(graphemeCount(family)).toBe(1);
    // String.length is 11 here — the audit's concern about cap-bypass via
    // emoji families. graphemeCount gives the user-facing length.
    expect(family.length).toBeGreaterThan(1);
  });

  it('handles empty input', () => {
    expect(graphemeCount('')).toBe(0);
  });
});
