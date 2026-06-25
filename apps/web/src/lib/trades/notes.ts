/**
 * Pure-text helpers for `Trade.notes` (J2).
 *
 * Lives in its own module so it can be unit-tested without spinning up
 * Prisma. Both phases of the trade lifecycle write notes:
 *   - Pre-entry: optional free-form text submitted with the wizard.
 *   - Post-exit: optional reflection submitted with the close-out form.
 *
 * The two are appended (not replaced) so members keep a trace of what
 * they were thinking before the trade vs. after.
 */

const SECTION_DELIMITER = '\n\n--- Sortie ---\n';

/**
 * Combine pre-entry notes with the close-out addition.
 *
 * Behaviour:
 *   - `addition` empty / undefined → returns `prior` unchanged.
 *   - `prior` empty / null → returns `addition`.
 *   - Both present → `${prior}${SECTION_DELIMITER}${addition}`.
 */
export function mergeNotes(prior: string | null, addition: string | undefined): string | null {
  if (!addition || addition.length === 0) return prior;
  if (!prior || prior.length === 0) return addition;
  return `${prior}${SECTION_DELIMITER}${addition}`;
}

/**
 * S4 §33 (enrichissement #2) — the inverse of {@link mergeNotes} for display.
 *
 * Splits a stored `Trade.notes` back into its two authored moments so the trade
 * detail can lay the pre-entry intention next to the post-exit débrief (the
 * « relire le trade comme une histoire » intent of enrichment #2).
 *
 * HONESTY about the merge's ambiguity: `mergeNotes(null, exitNote)` stores the
 * exit reflection WITHOUT the delimiter (it's the only section), so a delimiter-
 * less note is structurally indistinguishable between « pre-entry only » and
 * « exit only ». We therefore only claim the avant/après split when the
 * delimiter is actually present (`hasSections`). Otherwise we hand the text back
 * verbatim as `raw` and let the caller label it neutrally — never fabricating an
 * « Avant » / « Débrief » label we can't prove from the data.
 */
export interface SplitNotes {
  /** Pre-entry note — only set when `hasSections` (delimiter present). */
  readonly entry: string | null;
  /** Post-exit débrief — only set when `hasSections`. */
  readonly debrief: string | null;
  /** The undifferentiated note when there is no section delimiter. */
  readonly raw: string | null;
  /** `true` only when both moments were authored (delimiter present). */
  readonly hasSections: boolean;
}

export function splitNotes(notes: string | null | undefined): SplitNotes {
  if (!notes || notes.length === 0) {
    return { entry: null, debrief: null, raw: null, hasSections: false };
  }
  const idx = notes.indexOf(SECTION_DELIMITER);
  if (idx === -1) {
    return { entry: null, debrief: null, raw: notes, hasSections: false };
  }
  const entry = notes.slice(0, idx);
  const debrief = notes.slice(idx + SECTION_DELIMITER.length);
  return {
    entry: entry.length > 0 ? entry : null,
    debrief: debrief.length > 0 ? debrief : null,
    raw: null,
    hasSections: true,
  };
}
