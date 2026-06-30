import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * F5 (overhaul, 2026-06-30) — admin member-moderation schemas.
 *
 * Single source of truth for the "Modération" panel form (`useActionState`)
 * and its Server Action re-validation. The server is the only authority.
 *
 * The motif (`reason`) is OPTIONAL — the admin may suspend / reinstate "avec
 * ou sans motif" (Eliott's brief verbatim). It is hardened with the Fxmily
 * free-text canon (mirror `adminNoteCreateSchema`): reject bidi / zero-width
 * control chars (Trojan-Source defense — the motif is rendered back to the
 * admin and stored), then `safeFreeText` (trim + NFC + strip). An empty motif
 * normalises to `null` so the DB never stores a meaningless empty string.
 */

/** Hard upper bound on a moderation motif. ~1 000 chars = a long paragraph,
 * far more than a reason needs, while keeping a runaway paste bounded. */
export const MEMBER_MODERATION_REASON_MAX = 1000;

const reasonSchema = z
  .string()
  .trim()
  .max(MEMBER_MODERATION_REASON_MAX, `Maximum ${MEMBER_MODERATION_REASON_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Optional motif → empty normalises to null (suspend/reinstate "sans motif").
  .transform((s) => (s.length === 0 ? null : s));

/** Schema for the admin suspend / reinstate Server Actions (shared shape). */
export const memberModerationActionSchema = z.object({
  reason: reasonSchema,
});

export type MemberModerationActionInput = z.infer<typeof memberModerationActionSchema>;
