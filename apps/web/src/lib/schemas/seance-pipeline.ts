import { z } from 'zod';

import { CANONICAL_SYMBOLS, OUTPUT_BIAS } from '@/lib/seances/pipeline-canonical';
import { SEANCE_SLOTS } from '@/lib/seances/admin-derive';

import { seanceDateSchema } from './seance';

/**
 * Réunion hub (séances) J4 — Zod contract for the local content pipeline PERSIST
 * payload (`POST /api/admin/seances-batch/persist`).
 *
 * The local orchestrator (Zoom→Vimeo→Fathom→IA bornée, Règle n°1) pushes a FULL
 * idempotent snapshot of a HELD session: pipeline checkpoints + Vimeo/transcript
 * metadata + the faithful editorial content (summary, A-Z key takeaways, the 6
 * canonical asset cards, the 6 Discord messages). This schema is the STRUCTURAL
 * net (shapes, enums, `.strict()` unknown-key rejection, cross-field
 * consistency) — the SEMANTIC Règle n°1 net (emoji-free, AI-attribution-free,
 * exactly-6 cardinality, identity injection from canon) runs at the service
 * boundary via `assembleSeanceContent` (mirror the verification batch's
 * Zod-then-service double net).
 *
 * Single source of truth for the route's `safeParse`. `.strict()` mirrors
 * `seanceGoNoGoSchema` — defence-in-depth against a future pipeline bug that
 * adds an unexpected key. The asset/message IDENTITIES (`name`/`macro`) are
 * NEVER part of this payload: the service injects them from the canon so a
 * compromised pipeline machine can never fabricate, drop, reorder or relabel an
 * asset (the cardinal Règle n°1 invariant).
 */

const checkpointsSchema = z
  .object({
    mp4: z.boolean(),
    vimeo: z.boolean(),
    transcript: z.boolean(),
    ai: z.boolean(),
    deployed: z.boolean(),
  })
  .strict();

/** Vimeo metadata. `id` is digits-only (the embed builder rejects anything else). */
const vimeoSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9]+$/, { error: 'vimeo.id doit être numérique.' }),
    hash: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]+$/, { error: 'vimeo.hash alphanumérique.' })
      .optional(),
    embedUrl: z.string().trim().url().optional(),
    processing: z.boolean(),
  })
  .strict();

/** Transcript source — pinned to the `ReplayTranscriptSource` Prisma enum. */
const transcriptSchema = z
  .object({
    source: z.enum(['fathom', 'whisper', 'manual'], { error: 'Source de transcript inconnue.' }),
    lang: z.string().trim().min(1).max(16),
    pending: z.boolean(),
  })
  .strict();

const levelSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(120),
  })
  .strict();

/**
 * One asset entry — the AI-output shape ONLY (`symbol`/`bias`/`levels`/
 * `reading`). `name`/`macro` are deliberately ABSENT: the service injects them
 * from `CANONICAL_ASSETS`. `symbol` is pinned to the canonical enum and `bias`
 * to the 3-value enum (anti enum-fuzzing / hallucinated identity).
 */
const assetSchema = z
  .object({
    symbol: z.enum(CANONICAL_SYMBOLS as [string, ...string[]], { error: 'Actif inconnu.' }),
    bias: z.enum(OUTPUT_BIAS, { error: 'Biais invalide.' }),
    levels: z.array(levelSchema).max(40).optional(),
    reading: z.array(z.string().trim().min(1).max(8000)).max(40),
  })
  .strict();

const messageSchema = z
  .object({
    asset: z.enum(CANONICAL_SYMBOLS as [string, ...string[]], { error: 'Actif inconnu.' }),
    text: z.string().trim().min(1).max(8000),
  })
  .strict();

const contentSchema = z
  .object({
    summary: z.string().trim().min(1).max(8000),
    keyTakeaways: z.array(z.string().trim().min(1).max(8000)).max(40).default([]),
    contentModel: z.string().trim().min(1).max(120).optional(),
    assets: z.array(assetSchema).min(1).max(12),
    messages: z.array(messageSchema).min(1).max(12),
  })
  .strict();

const failureSchema = z
  .object({
    step: z.enum(['mp4', 'vimeo', 'transcript', 'ai', 'deployed'], { error: 'Étape inconnue.' }),
    error: z.string().trim().min(1).max(2000),
  })
  .strict();

/** One held session's full pipeline snapshot. */
export const seancePipelineSessionSchema = z
  .object({
    date: seanceDateSchema,
    slot: z.enum(SEANCE_SLOTS, { error: 'Créneau invalide.' }),
    /** Replay length in SECONDS (the model stores seconds; `formatDuration`). */
    durationSec: z.number().int().nonnegative().max(86_400).nullable().default(null),
    checkpoints: checkpointsSchema,
    vimeo: vimeoSchema.nullable().default(null),
    transcript: transcriptSchema.nullable().default(null),
    /** Dead-letter flag: a fallback (AI off-schema) leaves the slot needing review. */
    contentNeedsReview: z.boolean().default(false),
    content: contentSchema.nullable().default(null),
    failure: failureSchema.nullable().default(null),
  })
  .strict()
  .superRefine((s, ctx) => {
    // cpAi ⟺ content present. The `ai` checkpoint means the faithful content was
    // generated and is still on the row; clearing it means no content. This
    // keeps the writer's content/no-content branch unambiguous.
    if (s.checkpoints.ai && s.content === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'checkpoints.ai=true exige un content (contenu généré).',
      });
    }
    if (!s.checkpoints.ai && s.content !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['checkpoints', 'ai'],
        message: 'content présent exige checkpoints.ai=true.',
      });
    }
    // cpVimeo ⟹ vimeo metadata with an id.
    if (s.checkpoints.vimeo && (s.vimeo === null || s.vimeo.id.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['vimeo'],
        message: 'checkpoints.vimeo=true exige vimeo.id.',
      });
    }
    // cpTranscript ⟹ transcript present AND no longer pending.
    if (s.checkpoints.transcript && (s.transcript === null || s.transcript.pending)) {
      ctx.addIssue({
        code: 'custom',
        path: ['transcript'],
        message: 'checkpoints.transcript=true exige un transcript non pending.',
      });
    }
    // NOTE: `content` present + `contentNeedsReview=true` is intentionally
    // ALLOWED — a regeneration fallback faithfully re-pushes the still-valid OLD
    // content (cpAi stays true) while flagging it for review. `needsReview` is
    // therefore independent of `content` presence (only constrained by cpAi⟺
    // content above). The two legitimate needs-review states are: first fallback
    // (cpAi=false, content=null) and regen fallback (cpAi=true, content=old).
  });

export type SeancePipelineSessionInput = z.infer<typeof seancePipelineSessionSchema>;

/** The persist envelope: a batch of held-session snapshots. */
export const seancePipelinePersistSchema = z
  .object({
    sessions: z.array(seancePipelineSessionSchema).min(1).max(50),
  })
  .strict();

export type SeancePipelinePersistInput = z.infer<typeof seancePipelinePersistSchema>;
