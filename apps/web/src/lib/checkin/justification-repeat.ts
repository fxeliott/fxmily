/**
 * F7 §33.2 — deterministic REDUNDANCY signal for rattrapage justifications.
 *
 * The brief asks for « data pour l'IA (juge justification bonne / redondante /
 * mensonge) ». The *redundant* axis is the one we can answer deterministically,
 * with zero AI and zero fabrication: did the member reuse the same wording to
 * justify catching up a missed check-in? This module folds each justification
 * to a comparison key and flags reuse within a bounded window.
 *
 * It is NOT a lie detector and asserts NO verdict on legitimacy — the « bonne /
 * mensonge » axes are a human + J2-AI judgment (SPEC §7: no fabricated AI
 * verdict). Anti-Black-Hat §31.2: the signal is admin-only supervision — the
 * member never sees a « repeated / suspicious » badge on their own history.
 *
 * Pure + framework-free (a plain structural input, no Prisma / server-only
 * coupling) so it unit-tests in isolation and runs on either side.
 */

/** Window (days) within which two rattrapage justifications count as a repeat. */
export const JUSTIFICATION_REPEAT_WINDOW_DAYS = 14;
/** A normalized justification shared by at least this many backfills is flagged. */
export const JUSTIFICATION_REPEAT_THRESHOLD = 2;

/**
 * Fold a justification to a comparison key: strip accents (NFD + drop combining
 * marks), lowercase, collapse every run of non-alphanumeric chars to a single
 * space, trim. Returns '' when nothing meaningful remains (never flagged).
 *
 * So « Panne internet, hier soir ! » and « panne  internet hier soir » collapse
 * to the same key — a member can't dodge the signal with punctuation / casing.
 */
export function normalizeJustification(raw: string): string {
  return Array.from(raw.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f; // drop combining diacritical marks
    })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Minimal structural shape (a `SerializedCheckin` satisfies it). */
export interface JustificationRepeatInput {
  id: string;
  backfilledAt: string | null;
  lateJustification: string | null;
}

/**
 * Flag which backfilled check-ins reuse the same justification. Returns a
 * `Map<checkinId, occurrenceCount>` for every backfill whose normalized
 * justification is shared by at least {@link JUSTIFICATION_REPEAT_THRESHOLD}
 * backfills (including itself) within
 * {@link JUSTIFICATION_REPEAT_WINDOW_DAYS} of it. `occurrenceCount` = how many
 * peers share the wording in that window, so the admin can read « réutilisée 3×».
 *
 * On-time check-ins (no `backfilledAt`) and empty/whitespace justifications are
 * ignored. O(n²) but admin-only over a member's ~30-day panel — never a hot path.
 */
export function detectRepeatedJustifications(
  checkins: readonly JustificationRepeatInput[],
): Map<string, number> {
  const backfills = checkins
    .filter((c) => c.backfilledAt !== null && c.lateJustification !== null)
    .map((c) => ({
      id: c.id,
      at: new Date(c.backfilledAt as string).getTime(),
      key: normalizeJustification(c.lateJustification as string),
    }))
    .filter((c) => c.key !== '' && Number.isFinite(c.at));

  const windowMs = JUSTIFICATION_REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const out = new Map<string, number>();
  for (const a of backfills) {
    let count = 0;
    for (const b of backfills) {
      if (b.key === a.key && Math.abs(a.at - b.at) <= windowMs) count += 1;
    }
    if (count >= JUSTIFICATION_REPEAT_THRESHOLD) out.set(a.id, count);
  }
  return out;
}
