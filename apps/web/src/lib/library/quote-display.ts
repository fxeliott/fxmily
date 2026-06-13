/**
 * Mark Douglas card quote display helpers (S5 Jalon B — D5-01).
 *
 * Some cards carry a faithful PARAPHRASE of Douglas's teaching rather than a
 * verbatim citation (4 quotes were found fabricated/non-canonical at the 10th
 * challenge, and the corpus already had 8 more cards that self-declare
 * "paraphrase de l'argument" / "synthèse" in `quoteSourceChapter` yet were
 * still rendered as verbatim «...»). The UI must NOT frame a paraphrase as a
 * verbatim quote (no «...» guillemets, "D'après Mark Douglas" attribution) —
 * SPEC §2 "paraphrases attribuées", honest attribution.
 *
 * Convention : a paraphrase is flagged by a parenthetical containing
 * "paraphrase" or "synthèse" in `quoteSourceChapter` (e.g. "Trading in the
 * Zone, ch.11 (paraphrase)"). Verbatim cards use parentheticals like
 * "(5 fundamental truths)" which do NOT match — they keep the «...» framing.
 *
 * Pure string helpers, no deps — usable in Server Components.
 */

/** Matches a paraphrase/synthèse marker anywhere in the attribution. */
const PARAPHRASE_RE = /paraphrase|synth/i;

/** Strips a trailing `(… paraphrase …)` / `(… synthèse …)` parenthetical. */
const PARAPHRASE_SUFFIX_RE = /\s*\([^)]*(?:paraphrase|synth)[^)]*\)\s*$/i;

/** True iff this card's "quote" is an attributed paraphrase, not a verbatim citation. */
export function isParaphraseQuote(quoteSourceChapter: string): boolean {
  return PARAPHRASE_RE.test(quoteSourceChapter);
}

/**
 * The source attribution without the paraphrase marker (e.g.
 * "Trading in the Zone, ch.11"). Falls back to the raw string if the marker
 * isn't a trailing parenthetical (defensive — keeps something sensible).
 */
export function cleanQuoteSource(quoteSourceChapter: string): string {
  return quoteSourceChapter.replace(PARAPHRASE_SUFFIX_RE, '').trim();
}
