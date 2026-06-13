import { describe, expect, it } from 'vitest';

import { cleanQuoteSource, isParaphraseQuote } from './quote-display';

describe('quote-display (S5 Jalon B — D5-01)', () => {
  it('detects a paraphrase across every marker format in the corpus', () => {
    expect(isParaphraseQuote('Trading in the Zone (paraphrase)')).toBe(true);
    expect(isParaphraseQuote('The Disciplined Trader (paraphrase)')).toBe(true);
    expect(isParaphraseQuote('Trading in the Zone, ch.7 (paraphrase de l’argument central)')).toBe(
      true,
    );
    expect(isParaphraseQuote('Trading in the Zone, ch.11 (paraphrase synthèse)')).toBe(true);
    expect(isParaphraseQuote('The Disciplined Trader, ch.16 (synthèse de l’argument)')).toBe(true);
  });

  it('a verbatim citation (incl. non-paraphrase parentheticals) is not flagged', () => {
    expect(isParaphraseQuote('Trading in the Zone, ch.6')).toBe(false);
    expect(isParaphraseQuote('The Disciplined Trader, ch.10')).toBe(false);
    expect(isParaphraseQuote('Trading in the Zone, ch.3 (5 fundamental truths)')).toBe(false);
    expect(isParaphraseQuote('Trading in the Zone (4 primary trading fears)')).toBe(false);
  });

  it('strips the paraphrase marker for display, keeping book + chapter', () => {
    expect(cleanQuoteSource('Trading in the Zone (paraphrase)')).toBe('Trading in the Zone');
    expect(cleanQuoteSource('Trading in the Zone, ch.11 (paraphrase)')).toBe(
      'Trading in the Zone, ch.11',
    );
    expect(cleanQuoteSource('The Disciplined Trader, ch.16 (synthèse de l’argument)')).toBe(
      'The Disciplined Trader, ch.16',
    );
    expect(cleanQuoteSource('Trading in the Zone, ch.7 (paraphrase de l’argument central)')).toBe(
      'Trading in the Zone, ch.7',
    );
  });

  it('leaves a verbatim source untouched', () => {
    expect(cleanQuoteSource('Trading in the Zone, ch.6')).toBe('Trading in the Zone, ch.6');
    expect(cleanQuoteSource('Trading in the Zone, ch.3 (5 fundamental truths)')).toBe(
      'Trading in the Zone, ch.3 (5 fundamental truths)',
    );
  });
});
