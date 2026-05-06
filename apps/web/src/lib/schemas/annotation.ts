import { z } from 'zod';

/**
 * Trade annotation schemas (J4, SPEC §6.3, §7.8).
 *
 * Single source of truth for both client (Sheet form `useActionState`) and
 * server (Server Action re-validation). The server is the only authority.
 *
 * V1 supports image media only (8 MiB cap, JPEG/PNG/WebP). The 500 MiB
 * Zoom-video upload path is deferred to J4.5 once R2 is wired — when ready,
 * extend `mediaTypeSchema` with `'video'` and the storage key alternation.
 */

/** Hard upper bound on the markdown comment. 5 000 chars covers a long
 * paragraph block; we don't want a runaway paste destroying perf. */
export const ANNOTATION_COMMENT_MAX = 5000;

/** Storage key for annotation image media (J4).
 *
 *   annotations/{tradeId}/{nanoid32}.{jpg|png|webp}
 *
 * Mirrors the trade screenshot key shape — see `lib/storage/keys.ts`. */
const annotationImageKeySchema = z
  .string()
  .regex(
    /^annotations\/[a-z0-9]{8,40}\/[a-zA-Z0-9_-]{12,40}\.(jpg|png|webp)$/,
    'Clé fichier invalide.',
  );

const commentSchema = z
  .string()
  .trim()
  .min(1, 'Le commentaire est obligatoire.')
  .max(ANNOTATION_COMMENT_MAX, `Maximum ${ANNOTATION_COMMENT_MAX} caractères.`);

/** V1 media type allowlist. Adding `video` is a server-only change once R2
 * is wired (J4.5). The DB enum already accepts it. */
const mediaTypeSchema = z.enum(['image']);

/**
 * Schema for the admin "create annotation" Server Action.
 *
 * Either `mediaKey + mediaType` are both provided, or both null/absent.
 * The combination is validated via `superRefine` so the client gets a clear
 * field-level error rather than a vague "invalid input".
 */
export const annotationCreateSchema = z
  .object({
    comment: commentSchema,
    mediaKey: annotationImageKeySchema.nullable().optional(),
    mediaType: mediaTypeSchema.nullable().optional(),
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
  });

export type AnnotationCreateInput = z.infer<typeof annotationCreateSchema>;
