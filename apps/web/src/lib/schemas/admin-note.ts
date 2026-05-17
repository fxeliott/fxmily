import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * Admin private-note schemas (V2.1, SPEC §7.7).
 *
 * Single source of truth for the admin "Notes admin" tab form
 * (`useActionState`) and its Server Action re-validation. The server is
 * the only authority.
 *
 * `body` is hardened with the Fxmily free-text canon (same pattern as the
 * J4 annotation comment, J7 card paraphrase, V1.8 reflection): reject
 * bidi / zero-width control chars (Trojan-Source defense — these notes are
 * rendered back to the admin and may one day feed an LLM prompt) then
 * `safeFreeText` (trim + NFC + strip). Rejecting (rather than silently
 * stripping) bidi is the more defensible UX: the admin sees "invalid
 * characters" instead of their note mysteriously shortening.
 */

/** Hard upper bound on a single note. ~2 000 chars = a long paragraph;
 * keeps a runaway paste from bloating the admin tab + the DB row. */
export const ADMIN_NOTE_BODY_MAX = 2000;

const bodySchema = z
  .string()
  .trim()
  .min(1, 'La note ne peut pas être vide.')
  .max(ADMIN_NOTE_BODY_MAX, `Maximum ${ADMIN_NOTE_BODY_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/** Schema for the admin "create note" Server Action. */
export const adminNoteCreateSchema = z.object({
  body: bodySchema,
});

export type AdminNoteCreateInput = z.infer<typeof adminNoteCreateSchema>;
