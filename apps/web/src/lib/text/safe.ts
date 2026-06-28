/**
 * Safe-text helpers for free-form user input (J5 audit MEDIUM M5 fix).
 *
 * Hardens any free-text field that will be:
 *   - persisted in DB (prevent normalization-collision dedup bugs);
 *   - rendered server-side later (prevent RTL/zero-width attacks on admins);
 *   - **fed to a Claude prompt at J8** (prevent prompt-injection via hidden
 *     bidirectional control characters).
 *
 * Two layers of defence:
 *
 * 1. **Unicode NFC normalization** — collapses representation variants
 *    (`é` as one code point vs `e` + combining acute) so two identical-looking
 *    strings compare equal in queries and indexes.
 *
 * 2. **Bidirectional + zero-width control character stripping** — removes the
 *    eight Unicode formatting characters that can hide content from a human
 *    reviewer while a machine still sees it. The classic attack vector here
 *    is the "Trojan Source" exploit (Boucher & Anderson, 2021): a comment
 *    that looks innocuous to the eye but reorders execution / injects
 *    instructions into an LLM prompt downstream.
 *
 * Stripped characters:
 *   - U+200B ZERO WIDTH SPACE
 *   - U+200C ZERO WIDTH NON-JOINER
 *   - U+200D ZERO WIDTH JOINER
 *   - U+200E LEFT-TO-RIGHT MARK
 *   - U+200F RIGHT-TO-LEFT MARK
 *   - U+202A–U+202E LRE / RLE / PDF / LRO / RLO (legacy bidi controls)
 *   - U+2066–U+2069 LRI / RLI / FSI / PDI (current bidi controls)
 *   - U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
 *   - U+E0000–U+E007F UNICODE TAG range (invisible "tag" characters that can
 *     smuggle a full hidden instruction stream into an LLM prompt — the modern
 *     evolution of the Trojan-Source class; stripped at the source so the tag
 *     payload never reaches the Claude prompt builders downstream).
 *
 * NOT stripped (legitimate use): ASCII whitespace, French diacritics,
 * emoji ZWJ sequences (the 200D inside `👨‍👩‍👧‍👦` IS stripped — V1 trade-off,
 * we don't need to support emoji families in trader journal entries; the
 * single-code-point variant of the emoji still renders fine).
 */

// `u` flag is REQUIRED: the U+E0000–U+E007F tag range is astral (surrogate
// pairs), so a non-`u` regex can't express it as a range. Escapes (not literal
// glyphs) keep the class readable and copy-paste-safe across editors.
const BIDI_AND_ZW_RE = /[​-‏‪-‮⁦-⁩﻿\u{E0000}-\u{E007F}]/gu;

/**
 * Sanitize a free-text string: trim, NFC normalize, strip bidi/zero-width
 * controls. Idempotent (running twice yields the same result).
 */
export function safeFreeText(input: string): string {
  return input.trim().normalize('NFC').replace(BIDI_AND_ZW_RE, '');
}

/**
 * Returns true if the string contains any of the stripped control characters.
 * Used by Zod refinements that prefer to REJECT rather than silently strip
 * (more defensible: the user sees "invalid characters" rather than seeing
 * their input mysteriously shorten).
 */
export function containsBidiOrZeroWidth(input: string): boolean {
  BIDI_AND_ZW_RE.lastIndex = 0;
  return BIDI_AND_ZW_RE.test(input);
}

/**
 * Count grapheme clusters via `Intl.Segmenter` — a more accurate length
 * measure than `String.length` (UTF-16 code units) for cap-checks on free
 * text. Falls back to `Array.from(input).length` (code points) when
 * `Intl.Segmenter` is unavailable (Node ≥18 has it; the fallback is for
 * pre-18 runtimes that we don't ship to but defensive).
 */
export function graphemeCount(input: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
    let n = 0;
    for (const _ of segmenter.segment(input)) n += 1;
    return n;
  }
  return Array.from(input).length;
}
