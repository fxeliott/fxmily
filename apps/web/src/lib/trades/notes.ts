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
