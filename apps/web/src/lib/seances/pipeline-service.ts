import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { reportError } from '@/lib/observability';

import { ADMIN_SEANCE_HORIZON_DAYS, ADMIN_SEANCE_PAST_DAYS, seanceToday } from './admin-derive';
import { deriveSeanceTime, deriveSeanceTitle, type SeanceSlot, type SeanceStatus } from './derive';
import { assembleSeanceContent } from './pipeline-canonical';
import type {
  SeancePipelinePersistInput,
  SeancePipelineSessionInput,
} from '@/lib/schemas/seance-pipeline';

/**
 * Réunion hub (séances) J4 — local content pipeline BRIDGE service (server-only,
 * DB-aware). The 6th local Claude pipeline: Eliott's pipeline machine runs the
 * full Zoom→Vimeo→Fathom→IA-bornée flow (the standalone hub's
 * `orchestrate.mjs`/`generate-content.mjs`, Opus 4.8 headless, $0), then SYNCS
 * the result into Fxmily so the members read it at `/seances`.
 *
 *   Eliott local pipeline machine            Hetzner prod (Caddy → fxmily-web)
 *   ════════════════════════════            ════════════════════════════════════
 *     /seances-batch (local script)
 *     │ curl POST X-Admin-Token ─→  /api/admin/seances-batch/pull
 *     │                             (declared go/no-go + sync state, PII-free)
 *     │  apply go/no-go locally → record → Vimeo → Fathom → IA bornée (Règle n°1)
 *     │ curl POST X-Admin-Token ─→  /api/admin/seances-batch/persist
 *     │                             │ Gate1 session declared (admin owns it)
 *     │                             │ Gate2 status==='done' (held; never a no-go)
 *     │                             │ Gate3 Règle n°1 re-validation (assemble)
 *     │                             │ idempotent snapshot write (admin fields
 *     │                             │ untouched) + pipelineSyncedAt stamp
 *
 * Authority split (cardinal): the ADMIN owns a session's EXISTENCE + `status` +
 * `time`/`title`/`cancelReason` (J3 go/no-go, `admin-service.ts`); the PIPELINE
 * owns the checkpoints + Vimeo/transcript metadata + editorial content. This
 * service writes ONLY the latter — it NEVER creates a session (no-backfill) and
 * NEVER overwrites an admin-owned field, so the two surfaces stay 1:1 with the
 * standalone hub. 0 FK to User → no member PII is ever touched here (posture §2).
 *
 * Règle n°1 (supreme): the pipeline machine is UNTRUSTED at this boundary, so
 * the content is re-validated with the SAME semantic gate the standalone applied
 * (`assembleSeanceContent` — emoji-free, AI-attribution-free, exactly 6 assets/6
 * messages, identities INJECTED from canon). A forged payload can never invent,
 * drop, reorder or relabel an asset, nor publish a fabricated analysis.
 */

// =============================================================================
// Pull side — declared go/no-go sessions + their sync state (PII-free)
// =============================================================================

export interface SeancePipelineCheckpoints {
  readonly mp4: boolean;
  readonly vimeo: boolean;
  readonly transcript: boolean;
  readonly ai: boolean;
  readonly deployed: boolean;
}

/** One declared session as the local orchestrator consumes it (go/no-go + sync). */
export interface SeancePipelinePullSession {
  readonly date: LocalDateString;
  readonly slot: SeanceSlot;
  readonly status: SeanceStatus;
  /** FR display time ("12h00"), derived from slot when unset. */
  readonly time: string;
  readonly title: string;
  /** Admin cancel note (only meaningful when cancelled). */
  readonly cancelReason: string | null;
  readonly checkpoints: SeancePipelineCheckpoints;
  /** True when the AI content is flagged for regeneration. */
  readonly contentNeedsReview: boolean;
  /** True once the AI step produced faithful content (cpAi mirror). */
  readonly contentGenerated: boolean;
  /** ISO of the last successful pipeline sync, or null (never synced). */
  readonly syncedAt: string | null;
}

export interface SeancePipelinePullEnvelope {
  readonly ranAt: string;
  readonly sessions: readonly SeancePipelinePullSession[];
}

/**
 * Load the declared sessions in the rolling admin window `[today − PAST, today +
 * HORIZON]` with their current pipeline sync state. The local orchestrator uses
 * this to (a) apply the admin's go/no-go to its own state, (b) skip what is
 * already fully synced (idempotence), (c) re-arm a session flagged for
 * regeneration. Mirror of the standalone `admin-sync.getState().gonogo`, but
 * over Postgres instead of the Cloudflare KV. PII-free (0 FK to User).
 */
export async function loadSeancePipelineEnvelope(
  options: { now?: Date } = {},
): Promise<SeancePipelinePullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const today = seanceToday(now);
  const fromDate = parseLocalDate(shiftLocalDate(today, -ADMIN_SEANCE_PAST_DAYS));
  const toDate = parseLocalDate(shiftLocalDate(today, ADMIN_SEANCE_HORIZON_DAYS));

  const rows = await db.replaySession.findMany({
    where: { date: { gte: fromDate, lte: toDate } },
    orderBy: [{ date: 'desc' }, { slot: 'asc' }],
    select: {
      date: true,
      slot: true,
      status: true,
      title: true,
      time: true,
      cancelReason: true,
      cpMp4: true,
      cpVimeo: true,
      cpTranscript: true,
      cpAi: true,
      cpDeployed: true,
      contentNeedsReview: true,
      contentGenerated: true,
      pipelineSyncedAt: true,
    },
  });

  const sessions: SeancePipelinePullSession[] = rows.map((r) => {
    const date = r.date.toISOString().slice(0, 10) as LocalDateString;
    const slot = r.slot as SeanceSlot;
    return {
      date,
      slot,
      status: r.status as SeanceStatus,
      time: r.time ?? deriveSeanceTime(slot),
      title: r.title || deriveSeanceTitle(date, slot),
      cancelReason: r.cancelReason,
      checkpoints: {
        mp4: r.cpMp4,
        vimeo: r.cpVimeo,
        transcript: r.cpTranscript,
        ai: r.cpAi,
        deployed: r.cpDeployed,
      },
      contentNeedsReview: r.contentNeedsReview,
      contentGenerated: r.contentGenerated,
      syncedAt: r.pipelineSyncedAt ? r.pipelineSyncedAt.toISOString() : null,
    };
  });

  await logAudit({
    action: 'seance.batch.pulled',
    metadata: { ranAt, sessionsCount: sessions.length },
  });

  return { ranAt, sessions };
}

// =============================================================================
// Persist side — idempotent snapshot writer (admin fields untouched)
// =============================================================================

export interface SeancePipelinePersistResult {
  readonly persisted: number;
  readonly skipped: number;
  readonly errors: number;
}

/**
 * Persist a batch of held-session pipeline snapshots. Each entry is processed
 * independently (a single bad session never aborts the batch). Per session:
 *   - **Gate 1** the session must already be DECLARED by the admin (no-backfill:
 *     the pipeline never creates a row) → else `not_declared` skip.
 *   - **Gate 2** its status must be `done` (held) → a `scheduled` (not yet held)
 *     or `cancelled` (no-go) session never receives content → `not_done` skip.
 *   - **Gate 3** when content is present, it is re-validated with the Règle n°1
 *     semantic gate (`assembleSeanceContent`): off-schema → `invalid_output`
 *     error, no write.
 * A valid entry writes the pipeline fields idempotently (admin-owned
 * status/time/title/cancelReason untouched) and ALWAYS stamps `pipelineSyncedAt`
 * (so a no-op re-sync still records that it happened).
 */
export async function persistSeancePipelineResults(
  payload: SeancePipelinePersistInput,
  options: { now?: Date } = {},
): Promise<SeancePipelinePersistResult> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();

  let persisted = 0;
  let skipped = 0;
  let errors = 0;

  for (const session of payload.sessions) {
    let dateObj: Date;
    try {
      dateObj = parseLocalDate(session.date);
    } catch {
      // A structurally-valid `YYYY-MM-DD` that is not a real calendar date.
      skipped += 1;
      await logAudit({
        action: 'seance.batch.skipped',
        metadata: { ranAt, date: session.date, slot: session.slot, reason: 'invalid_date' },
      });
      continue;
    }

    const existing = await db.replaySession.findUnique({
      where: { date_slot: { date: dateObj, slot: session.slot } },
      select: { id: true, status: true },
    });

    // Gate 1 — the admin must have declared this session (no-backfill).
    if (!existing) {
      skipped += 1;
      await logAudit({
        action: 'seance.batch.skipped',
        metadata: { ranAt, date: session.date, slot: session.slot, reason: 'not_declared' },
      });
      continue;
    }

    // Gate 2 — only a HELD session accepts content (never a scheduled/cancelled).
    if (existing.status !== 'done') {
      skipped += 1;
      await logAudit({
        action: 'seance.batch.skipped',
        metadata: {
          ranAt,
          date: session.date,
          slot: session.slot,
          reason: 'not_done',
        },
      });
      continue;
    }

    // Gate 3 — Règle n°1 re-validation when content is present.
    let assembled: ReturnType<typeof assembleSeanceContent> | null = null;
    if (session.content !== null) {
      assembled = assembleSeanceContent(session.content);
      if (!assembled.ok) {
        errors += 1;
        await logAudit({
          action: 'seance.batch.invalid_output',
          metadata: {
            ranAt,
            date: session.date,
            slot: session.slot,
            errorsCount: assembled.errors.length,
          },
        });
        continue;
      }
    }

    try {
      await writeOneSeance(existing.id, session, assembled, now);
      persisted += 1;
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'seance.batch.persist_failed',
        metadata: {
          ranAt,
          date: session.date,
          slot: session.slot,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
      reportError(
        'seance.batch.persist',
        err instanceof Error ? err : new Error('seance_persist_unknown'),
        { date: session.date, slot: session.slot },
      );
    }
  }

  await logAudit({
    action: 'seance.batch.persisted',
    metadata: { ranAt, persisted, skipped, errors, total: payload.sessions.length },
  });

  return { persisted, skipped, errors };
}

/**
 * Write ONE held session's pipeline snapshot. The admin-owned fields (status,
 * time, title, cancelReason) are never in the `data` → they are preserved. The
 * editorial content (summary/keyTakeaways/assets/messages) is touched ONLY when
 * `assembled` is non-null (content present) — a content-less sync (e.g. mp4 only,
 * or a first fallback) preserves whatever editorial state is already there.
 * `pipelineSyncedAt` is ALWAYS stamped (the J3 dead column made live: it proves
 * the sync ran even when nothing else changed).
 */
async function writeOneSeance(
  id: string,
  session: SeancePipelineSessionInput,
  assembled: ReturnType<typeof assembleSeanceContent> | null,
  now: Date,
): Promise<void> {
  const pipelineData: Prisma.ReplaySessionUpdateInput = {
    duration: session.durationSec,
    cpMp4: session.checkpoints.mp4,
    cpVimeo: session.checkpoints.vimeo,
    cpTranscript: session.checkpoints.transcript,
    cpAi: session.checkpoints.ai,
    cpDeployed: session.checkpoints.deployed,
    vimeoId: session.vimeo?.id ?? null,
    vimeoHash: session.vimeo?.hash ?? null,
    vimeoEmbedUrl: session.vimeo?.embedUrl ?? null,
    vimeoProcessing: session.vimeo?.processing ?? false,
    transcriptSource: session.transcript?.source ?? null,
    transcriptLang: session.transcript?.lang ?? null,
    transcriptPending: session.transcript?.pending ?? false,
    contentGenerated: session.checkpoints.ai,
    contentNeedsReview: session.contentNeedsReview,
    pipelineFailedStep: session.failure?.step ?? null,
    pipelineFailedError: session.failure?.error ?? null,
    // Defect #2 fix — the J3 `pipelineSyncedAt` column was never written; stamp
    // it on EVERY persist so the admin pipeline view can show "synchronisé il y
    // a …" even for an otherwise-idempotent no-op re-sync.
    pipelineSyncedAt: now,
  };

  if (assembled === null) {
    // Content-less sync — preserve the existing editorial state (summary, assets,
    // messages, contentModel are untouched).
    await db.replaySession.update({ where: { id }, data: pipelineData });
    return;
  }

  // Content present — write the faithful editorial fields and REPLACE the asset
  // + message sets atomically (a single `update` is wrapped in one transaction,
  // and the nested `deleteMany` + `create` run inside it). Identities are
  // injected from the canon by `assembleSeanceContent` (never trusted).
  const { content } = assembled;
  await db.replaySession.update({
    where: { id },
    data: {
      ...pipelineData,
      summary: content.summary,
      keyTakeaways: content.keyTakeaways,
      contentModel: session.content?.contentModel ?? null,
      assets: {
        deleteMany: {},
        create: content.assets.map((a, index) => ({
          symbol: a.symbol,
          name: a.name,
          bias: a.bias,
          macro: a.macro,
          reading: a.reading,
          // Typed JSON → Prisma's `InputJsonValue` requires the canonical
          // double-cast (a `{label,value}[]` lacks the bare index signature).
          ...(a.levels.length > 0 ? { levels: a.levels as unknown as Prisma.InputJsonValue } : {}),
          position: index,
        })),
      },
      messages: {
        deleteMany: {},
        create: content.messages.map((m, index) => ({
          asset: m.asset,
          text: m.text,
          position: index,
        })),
      },
    },
  });
}
