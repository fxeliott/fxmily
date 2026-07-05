import { z } from 'zod';

import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { tradingViewUrlOptionalSchema } from '@/lib/schemas/tradingview-url';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import { trackingAxisSchema } from '@/lib/tracking/axes';

/**
 * Trade annotation schemas (J4, SPEC §6.3, §7.8).
 *
 * Single source of truth for both client (Sheet form `useActionState`) and
 * server (Server Action re-validation). The server is the only authority.
 *
 * Tour 13 — the correction now carries an OPTIONAL TradingView link in place of
 * the former image upload (pivot capture → lien). `mediaKey`/`mediaType` are no
 * longer accepted on CREATE: legacy rows stay readable, but a new correction
 * appuie ses screens via un lien TradingView, jamais un upload.
 */

/** Hard upper bound on the markdown comment. 5 000 chars covers a long
 * paragraph block; we don't want a runaway paste destroying perf. */
export const ANNOTATION_COMMENT_MAX = 5000;

// Phase P review T1.2 — defense-in-depth on admin-controlled annotation
// comments. Even though only admins can create annotations, this defends
// against compromise-spreading-via-trojan-source if an admin account is
// breached, and matches the pattern already established in card schemas.
const commentSchema = z
  .string()
  .trim()
  .min(1, 'Le commentaire est obligatoire.')
  .max(ANNOTATION_COMMENT_MAX, `Maximum ${ANNOTATION_COMMENT_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/**
 * Schema for the admin "create annotation" Server Action.
 *
 * Tour 13 — the optional artefact is a TradingView link (`tradingViewUrlOptional
 * Schema`: https-only + host allowlist + length cap + Trojan-Source reject,
 * shared with the journal + training surfaces). The former `mediaKey`/`mediaType`
 * upload pair is no longer accepted on create.
 */
export const annotationCreateSchema = z
  .object({
    comment: commentSchema,
    // Tour 13 — optional TradingView screen link (replaces the upload pair).
    tradingViewUrl: tradingViewUrlOptionalSchema,
    // J-AI corrections echo — optional coaching axis the admin tags the
    // correction with (one of the 11 `TrackingAxis` ids). Absent/empty = null
    // (untagged); the theming aggregate ignores untagged corrections.
    axis: trackingAxisSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // SPEC §2 posture invariant — the admin free-text comment is member-facing
    // (it lands on the member's trade/training annotation), so it MUST be held
    // to the same no-market-advice gate as every other admin→member surface
    // (Mark Douglas cards `lib/schemas/card.ts:185`, IA batches, onboarding…).
    // Until now the comment passed only `safeFreeText` + bidi stripping, so a
    // market-direction call ("short le DAX", "TP à 1.0850") from a compromised
    // or off-guard admin account would reach the member un-screened — the one
    // admin→member text path that bypassed `detectAMFViolation`. Mirror the
    // card schema's `assertNoMarketAdvice` so the guardrail is enforced at the
    // single source of truth instead of relying on admin discipline.
    if (detectAMFViolation(data.comment).suspected) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message:
          "Contenu interdit (§2) : un commentaire ne peut pas donner de conseil d'analyse de marché (direction, niveau ou objectif de prix).",
      });
    }
  });

export type AnnotationCreateInput = z.infer<typeof annotationCreateSchema>;
