import { z } from 'zod';

import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { TRAINING_ANNOTATION_KEY_PATTERN } from '@/lib/storage/keys';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import { trackingAxisSchema } from '@/lib/tracking/axes';

/**
 * Admin training-correction schema (V1.2 Mode Entraînement, SPEC §21).
 *
 * EXACT mirror of `lib/schemas/annotation.ts` (J4) but for the training
 * isolation surface: a correction attaches to a `TrainingTrade`, never a
 * real `Trade`. Single source of truth for the J-T3 admin Sheet form and
 * its Server Action re-validation — the server is the only authority.
 *
 * `comment` is hardened with the Fxmily free-text canon (reject bidi /
 * zero-width = Trojan-Source defense, then `safeFreeText`) — the comment is
 * rendered back to the member and could one day feed an LLM prompt. V1.2
 * ships image-only media (the DB enum accepts `video` for a later path,
 * mirror J4 → J4.5).
 */

/** Hard upper bound on the correction comment. Mirrors
 * `ANNOTATION_COMMENT_MAX` (J4). */
export const TRAINING_ANNOTATION_COMMENT_MAX = 5000;

/** Storage key for the optional correction media. Pattern sourced from
 * `lib/storage/keys` so validation and (J-T3) path-generation never drift. */
const trainingAnnotationImageKeySchema = z
  .string()
  .regex(TRAINING_ANNOTATION_KEY_PATTERN, 'Clé fichier invalide.');

const commentSchema = z
  .string()
  .trim()
  .min(1, 'Le commentaire est obligatoire.')
  .max(TRAINING_ANNOTATION_COMMENT_MAX, `Maximum ${TRAINING_ANNOTATION_COMMENT_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/** V1.2 media type allowlist. Adding `video` is a server-only change once
 * the video path is wired (mirror J4.5). The DB enum already accepts it. */
const mediaTypeSchema = z.enum(['image']);

/**
 * Schema for the admin "create training correction" Server Action (J-T3).
 *
 * Either `mediaKey + mediaType` are both provided, or both null/absent —
 * validated via `superRefine` for a clear field-level error (exact mirror
 * of `annotationCreateSchema`).
 */
export const trainingAnnotationCreateSchema = z
  .object({
    comment: commentSchema,
    mediaKey: trainingAnnotationImageKeySchema.nullable().optional(),
    mediaType: mediaTypeSchema.nullable().optional(),
    // J-AI corrections echo — optional coaching axis (mirror of
    // `annotationCreateSchema`), one of the 11 `TrackingAxis` ids or null.
    axis: trackingAxisSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasKey = data.mediaKey != null && data.mediaKey.length > 0;
    const hasType = data.mediaType != null;
    if (hasKey !== hasType) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaKey'],
        message: 'Média incomplet : la clé et le type doivent être fournis ensemble.',
      });
    }
    // SPEC §2 posture invariant — the training correction comment is rendered
    // back to the member, so it MUST pass the same no-market-advice gate as the
    // real-trade annotation (`lib/schemas/annotation.ts`) and the Mark Douglas
    // cards. Without this, the admin training-correction free-text was the
    // second un-screened admin→member path. Note: the member's *reply*
    // (`trainingReplyCreateSchema`) is member→admin, not member-facing, so it is
    // intentionally NOT subject to this gate.
    if (detectAMFViolation(data.comment).suspected) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message:
          "Contenu interdit (§2) : une correction ne peut pas donner de conseil d'analyse de marché (direction, niveau ou objectif de prix).",
      });
    }
  });

export type TrainingAnnotationCreateInput = z.infer<typeof trainingAnnotationCreateSchema>;

/** Hard upper bound on a member reply to a correction (S8 V2). A reply is a
 * short acknowledgement / question, not an essay — mirrors the lesson cap. */
export const TRAINING_REPLY_MAX = 2000;

const replyTextSchema = z
  .string()
  .trim()
  .min(1, 'Ta réponse ne peut pas être vide.')
  .max(TRAINING_REPLY_MAX, `Maximum ${TRAINING_REPLY_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/**
 * S8 V2 — member reply to an admin backtest correction (brief §32-4 : « le
 * membre les voit et peut y répondre »). Single source of truth for the member
 * Server Action re-validation — the server is the only authority. The reply is
 * hardened free text (Trojan-Source canon) and stays strictly within the
 * psychology/process register (garde-fou §2) like every member free-text field.
 * `trainingAnnotationId` is opaque; ownership is enforced server-side (the reply
 * only lands if the annotation belongs to a backtest owned by the caller).
 */
export const trainingReplyCreateSchema = z.object({
  trainingAnnotationId: z.string().trim().min(1, 'Correction introuvable.'),
  reply: replyTextSchema,
});

export type TrainingReplyCreateInput = z.infer<typeof trainingReplyCreateSchema>;
