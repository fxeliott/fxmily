/**
 * Deterministic typography belt for AI-GENERATED text (F-J1 punctuation guard).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every Fxmily surface that renders Claude output persisted in the DB must be
 * free of the "tirets cadratins" (em dash U+2014, en dash U+2013). Eliott's
 * French copy standard forbids them (`feedback_francais-sans-tirets`), and the
 * generation prompts already carry a PONCTUATION directive (#463) — but a model
 * can violate an instruction. This module is the DETERMINISTIC belt that runs at
 * the parse/persist boundary so that even a non-compliant generation can never
 * reach a member with an em/en dash.
 *
 * SCOPE — AI OUTPUT ONLY
 * ----------------------
 * This normaliser is applied to text that Claude PRODUCED (weekly report,
 * monthly debrief, adaptive calendar, member profile prose, séance editorial
 * content). It is deliberately NOT applied to member-typed input (journal notes,
 * onboarding answers, admin annotations) nor to evidence[] verbatim quotes — a
 * member who types a dash keeps their words, and a verbatim-substring evidence
 * check would break if we rewrote the quoted corpus.
 *
 * RULES (deterministic, mission-specified)
 * ----------------------------------------
 *   1. **Numeric range** — a dash (U+2013 or U+2014, with or without surrounding
 *      spaces) BETWEEN two digits becomes " à " :  "3–5" → "3 à 5",
 *      "10 — 20" → "10 à 20". Applied first so a range never falls through to
 *      the spaced/collapsed rules.
 *   2. **Spaced dash** — " — " (a dash flanked by whitespace) becomes " : ".
 *      The mission mandates " : " EVERYWHERE for the spaced form (deriving
 *      " . " vs " : " from the following word is too risky), so the choice is
 *      unconditional.
 *   3. **Collapsed dash** — a dash glued between two non-space characters
 *      ("mot—mot") becomes ", " :  "mot—mot" → "mot, mot".
 *   4. Any residual dash (e.g. a leading/trailing dash with a space on one side
 *      only) is collapsed to a single space so no em/en dash ever survives.
 *   5. Double spaces created by the substitutions are collapsed (never touching
 *      newlines / other whitespace runs beyond the ASCII space).
 *
 * Everything else is preserved verbatim: the typographic apostrophe U+2019,
 * French accents, markdown, hyphen-minus "-" (U+002D), figure dash, etc.
 *
 * The function is IDEMPOTENT: `f(f(x)) === f(x)` for all inputs (none of the
 * outputs — " à ", " : ", ", ", " " — reintroduce an em/en dash).
 */

/** Em dash U+2014 or en dash U+2013 — the two "tirets cadratins" we normalise. */
const DASH_CLASS = '[\\u2013\\u2014]';

/**
 * Numeric range: a digit, optional spaces, a dash, optional spaces, a digit.
 * Captures the two digits so we can re-emit them around " à ". `\d` is fine
 * here (we only care about ASCII digits printed by the model in ranges like
 * "3-5R", "12h–14h" the hours are still digits).
 */
const NUMERIC_RANGE_RE = new RegExp(`(\\d)\\s*${DASH_CLASS}\\s*(\\d)`, 'g');

/** Spaced dash: at least one whitespace char on BOTH sides of the dash. */
const SPACED_DASH_RE = new RegExp(`\\s+${DASH_CLASS}\\s+`, 'g');

/** Collapsed dash: a non-space char, the dash, a non-space char. */
const COLLAPSED_DASH_RE = new RegExp(`(\\S)${DASH_CLASS}(\\S)`, 'g');

/** Any remaining dash (asymmetric spacing, string edge, run of dashes). */
const RESIDUAL_DASH_RE = new RegExp(DASH_CLASS, 'g');

/** Runs of two or more ASCII spaces (does NOT touch newlines / tabs). */
const DOUBLE_SPACE_RE = / {2,}/g;

/**
 * Normalise em/en dashes in AI-generated text to simple French punctuation.
 *
 * Deterministic and idempotent — see the module doc for the exact rules.
 * Returns the input unchanged when it contains no U+2013 / U+2014.
 */
export function normalizeAiTypography(text: string): string {
  // Fast path: no em/en dash → nothing to do (preserves the string identity for
  // the overwhelming majority of well-behaved generations).
  if (!text.includes('—') && !text.includes('–')) return text;

  let out = text;

  // 1. Numeric ranges → " à " (run in a loop: adjacent ranges like "1–2–3"
  //    share a digit, so a single pass leaves the middle dash — re-run until
  //    stable). Bounded by the shrinking dash count, so it always terminates.
  let previous: string;
  do {
    previous = out;
    out = out.replace(NUMERIC_RANGE_RE, '$1 à $2');
  } while (out !== previous);

  // 2. Spaced dash → " : "
  out = out.replace(SPACED_DASH_RE, ' : ');

  // 3. Collapsed dash ("mot—mot") → ", "
  out = out.replace(COLLAPSED_DASH_RE, '$1, $2');

  // 4. Any residual dash (edge / asymmetric) → single space.
  out = out.replace(RESIDUAL_DASH_RE, ' ');

  // 5. Collapse double ASCII spaces created by the substitutions.
  out = out.replace(DOUBLE_SPACE_RE, ' ');

  // 6. Trim the ASCII-space edges a leading/trailing dash substitution may have
  //    introduced ("— suite" → " suite" → "suite"). We only strip spaces (not
  //    newlines), and only when a substitution ran, so well-formed prose that
  //    began/ended on a real space is unaffected in practice (schemas .trim()
  //    upstream anyway).
  out = out.replace(/^ +| +$/g, '');

  return out;
}
