import 'server-only';

import { createReadStream, createWriteStream, promises as fs, type ReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

import { ZipArchive, type Archiver } from 'archiver';

import { buildUserDataExport, summariseExport, type UserDataExport } from '@/lib/account/export';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { enqueueDataExportReadyNotification } from '@/lib/notifications/enqueue';
import { reportError, reportWarning } from '@/lib/observability';
import {
  isR2Configured,
  localUploadPathFor,
  openR2ReadStream,
  parseStorageKey,
} from '@/lib/storage';

/**
 * J6 (admin-scale, scope 6) — asynchronous RGPD export WITH media.
 *
 * The interactive `POST /api/account/data/export` route (J10) streams a JSON
 * snapshot synchronously but carries NO media (only opaque storage keys). At
 * 100+ members with photos, building a full archive inside the HTTP request is
 * the wrong shape: it blocks the request, buffers megabytes, and times out the
 * reverse proxy. This module runs the heavy work OUT of the request via a
 * `DataExportJob` row + `after()` (see `app/account/data/actions.ts`).
 *
 * Streaming contract (« pas de buffer RAM », J6 spec §6): the ZIP is piped
 * `archiver → createWriteStream` straight to the uploads volume — the archive
 * bytes never sit whole in memory. Media are appended file-by-file
 * (`archive.file()` for the local hot path — one FD at a time; R2 stream for a
 * local miss), so a member with hundreds of screenshots never opens hundreds of
 * descriptors nor loads them all in RAM. Only the JSON snapshot is a single
 * transient string (bounded per member, unavoidable for art.20 portability).
 *
 * The resulting zip lives under `<UPLOADS_DIR>/data-exports/<jobId>.zip` — the
 * SAME persistent volume as member uploads (no new infra), served back by the
 * auth-gated `GET /api/account/data/export/[jobId]` streamer.
 */

const EXPORT_KEY_PREFIX = 'data-exports';
/** A Prisma cuid is lowercase alnum — reject anything else before it touches a path. */
const JOB_ID_RE = /^[a-z0-9]+$/i;

/**
 * A `pending`/`processing` job older than this survived a process restart:
 * `after()` runs in-process and does NOT resume across a redeploy (Fxmily
 * auto-deploys on every `main` push), so its build died mid-flight and the row
 * is a zombie. Reaped lazily on the member's next request / page load so a stale
 * job can never permanently lock a member out of a fresh export. A real archive
 * build finishes in seconds to a couple of minutes even for a heavy member, so
 * 15 min is comfortably above any legitimate in-flight job.
 */
export const STALE_EXPORT_JOB_MS = 15 * 60 * 1000;

function exportsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR;
  const uploadsRoot =
    fromEnv && fromEnv.trim().length > 0
      ? path.resolve(fromEnv)
      : // Mirror `lib/storage/local.ts`: keep the tracer off `process.cwd()`.
        path.resolve(/* turbopackIgnore: true */ process.cwd(), '.uploads');
  return path.join(uploadsRoot, EXPORT_KEY_PREFIX);
}

function exportZipPath(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) {
    throw new Error('invalid export job id');
  }
  return path.join(exportsRoot(), `${jobId}.zip`);
}

/** Logical result key persisted on the job row (never trusted for path resolution). */
export function exportResultKey(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) {
    throw new Error('invalid export job id');
  }
  return `${EXPORT_KEY_PREFIX}/${jobId}.zip`;
}

/** Download filename — never leaks the full jobId (last 6 chars only). */
export function buildExportZipFilename(jobId: string): string {
  return `fxmily-export-${jobId.slice(-6)}.zip`;
}

/**
 * Deep-walk the export snapshot and collect every value that is a well-formed
 * storage key (`parseStorageKey` accepts `avatars|trades|proofs|annotations|
 * training|training_annotations`). Filtering by the parser — not by field name —
 * makes this robust to future media fields AND immune to false positives (a
 * reflection free-text can never match the strict `prefix/id/nanoid.ext` shape).
 * De-duplicated; `seen` guards against cyclic references (there are none in the
 * plain snapshot, but the walk stays total).
 */
export function collectMediaKeys(snapshot: UserDataExport): string[] {
  const keys = new Set<string>();
  const seen = new Set<object>();
  const walk = (val: unknown): void => {
    if (val === null || val === undefined) return;
    if (typeof val === 'string') {
      try {
        parseStorageKey(val);
        keys.add(val);
      } catch {
        // Not a storage key — ignore.
      }
      return;
    }
    if (typeof val !== 'object') return;
    if (seen.has(val as object)) return;
    seen.add(val as object);
    if (Array.isArray(val)) {
      for (const item of val) walk(item);
      return;
    }
    for (const v of Object.values(val as Record<string, unknown>)) walk(v);
  };
  walk(snapshot);
  return [...keys];
}

/**
 * Append one media key to the archive. Local-first (lazy `archive.file`), R2
 * fallback (streamed). A media missing from BOTH stores is SKIPPED, never
 * fatal — a stale key must not abort a member's whole portability export.
 * Returns true iff the entry was queued.
 */
async function appendOneMedia(archive: Archiver, key: string): Promise<boolean> {
  let localPath: string;
  try {
    localPath = localUploadPathFor(key);
  } catch {
    return false;
  }
  try {
    await fs.access(localPath);
    archive.file(localPath, { name: `media/${key}` });
    return true;
  } catch {
    // Local miss — fall through to the offsite R2 mirror when configured.
  }
  if (isR2Configured()) {
    try {
      const { stream } = await openR2ReadStream(key);
      archive.append(Readable.fromWeb(stream as unknown as NodeWebReadableStream<Uint8Array>), {
        name: `media/${key}`,
      });
      return true;
    } catch {
      // Missing offsite too — skip this media, never fail the whole export.
    }
  }
  return false;
}

/**
 * Pipe the JSON snapshot + every resolvable media into a ZIP on the uploads
 * volume. Resolves once the write stream is fully flushed (`output` 'close').
 */
async function writeExportZip(
  target: string,
  snapshot: UserDataExport,
  mediaKeys: string[],
): Promise<{ appended: number; skipped: number }> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  return await new Promise<{ appended: number; skipped: number }>((resolve, reject) => {
    const output = createWriteStream(target);
    // archiver@8 dropped the callable `archiver('zip')` factory — the format
    // archives are now classes (`new ZipArchive(...)`). Runtime-verified: the
    // package's root export is `{ Archiver, ZipArchive, TarArchive, JsonArchive }`,
    // no longer a function.
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let appended = 0;
    let skipped = 0;
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    output.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ appended, skipped });
    });
    output.on('error', fail);
    archive.on('error', fail);
    archive.on('warning', (err: Error & { code?: string }) => {
      // ENOENT = a file vanished between our `fs.access` and archiver reading it
      // (race with a concurrent deletion). Log + continue; anything else is fatal.
      if (err.code === 'ENOENT') {
        reportWarning('account.data.export_job', 'archive_entry_missing', {});
      } else {
        fail(err);
      }
    });
    archive.pipe(output);
    // The full JSON snapshot as one entry. The ZIP bytes stream to disk; only
    // this source string is transient in RAM (bounded per member).
    archive.append(JSON.stringify(snapshot, null, 2), { name: 'data.json' });
    void (async () => {
      try {
        for (const key of mediaKeys) {
          const ok = await appendOneMedia(archive, key);
          if (ok) appended += 1;
          else skipped += 1;
        }
        await archive.finalize();
      } catch (err) {
        fail(err);
      }
    })();
  });
}

/**
 * Best-effort removal of a job's zip artifact from the uploads volume. Never
 * throws (a missing file or a malformed id resolves to `false`). Shared by the
 * RGPD erasure sweep (`purgeMaterialisedDeletions`) and the per-member retention
 * prune below: the zip is a plain file on the LOCAL volume (never an R2 object,
 * never a `parseStorageKey` prefix), so `fs.rm` is the correct primitive rather
 * than `selectStorage().delete`.
 */
export async function removeExportZip(jobId: string): Promise<boolean> {
  let target: string;
  try {
    target = exportZipPath(jobId);
  } catch {
    return false; // malformed id — nothing to remove
  }
  try {
    await fs.rm(target, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reap a member's ZOMBIE export jobs: any `pending`/`processing` row older than
 * `STALE_EXPORT_JOB_MS` whose `after()` build died with the process. Marks them
 * `failed` so the dedup in `requestDataExportAction` can't reuse a zombie for
 * ever and lock the member out of a new export. Atomic (`updateMany`),
 * idempotent, best-effort (a reap failure never blocks the caller). Returns the
 * number of jobs reaped.
 */
export async function reapStaleExportJobs(userId: string, now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_EXPORT_JOB_MS);
  try {
    // Identify the zombies first so we can also reclaim the partial zip each dead
    // build may have left on the shared uploads volume.
    const stale = await db.dataExportJob.findMany({
      where: { userId, status: { in: ['pending', 'processing'] }, createdAt: { lt: threshold } },
      select: { id: true },
    });
    if (stale.length === 0) return 0;

    let reaped = 0;
    for (const job of stale) {
      // Re-check the status INSIDE the flip: if the build actually completed in
      // the tiny window since the read, the job is now `ready` with a VALID zip —
      // count 0, so we must NOT delete its file. Only reclaim zips of jobs we
      // genuinely reaped.
      const res = await db.dataExportJob.updateMany({
        where: { id: job.id, status: { in: ['pending', 'processing'] } },
        data: {
          status: 'failed',
          error: 'stale: reaped after a server restart interrupted the build',
        },
      });
      if (res.count === 1) {
        reaped += 1;
        await removeExportZip(job.id);
      }
    }
    return reaped;
  } catch {
    return 0;
  }
}

/**
 * Retention (J6 scale) — keep only the LATEST ready export per member. Older
 * ready zips on the shared uploads volume (which also stores member media) are
 * pruned so a member can't accumulate full-PII archives by regenerating, growing
 * the volume without bound. The audit trail lives in the immutable audit log,
 * not these transient rows. Best-effort: a prune failure must never fail the
 * export the member just completed.
 */
async function pruneSupersededExports(userId: string, keepJobId: string): Promise<void> {
  try {
    const superseded = await db.dataExportJob.findMany({
      where: { userId, status: 'ready', id: { not: keepJobId } },
      select: { id: true },
    });
    if (superseded.length === 0) return;
    // Only drop a row once its zip is CONFIRMED gone. `removeExportZip` returns
    // false on a real fs error — if we deleted the row anyway, the account-
    // erasure sweep (`deletion.ts`) iterates existing `DataExportJob` rows and
    // would never find the leftover full-PII archive, stranding it on the volume
    // past an art.17 erasure. Keeping the row preserves the pointer so a later
    // regenerate/erase can still reap the file.
    const removedIds: string[] = [];
    for (const job of superseded) {
      if (await removeExportZip(job.id)) {
        removedIds.push(job.id);
      }
    }
    if (removedIds.length > 0) {
      await db.dataExportJob.deleteMany({ where: { id: { in: removedIds } } });
    }
  } catch {
    reportWarning('account.data.export_job', 'retention_prune_failed', {});
  }
}

export interface RunDataExportResult {
  ok: boolean;
  reason?: string;
  byteSize?: number;
  mediaAppended?: number;
  mediaSkipped?: number;
}

/**
 * Run a queued `DataExportJob` to completion. STANDALONE (no HTTP): called from
 * `after()` in production and DIRECTLY in tests — the J6 "Done quand" proof
 * ("généré hors requête HTTP") exercises exactly this entry point. Idempotent
 * on a job already `ready`. Never throws: a failure flips the job to `failed`
 * with a truncated reason and reports to Sentry.
 */
export async function runDataExportJob(jobId: string): Promise<RunDataExportResult> {
  // Tracked outside the try so the `failed` audit can still name the member even
  // if a later step throws. Stays null only when the very first read fails (or
  // the job is missing), in which case there is nothing meaningful to audit.
  let userId: string | null = null;
  try {
    // Inside the try (contract: this function NEVER throws). A transient DB error
    // on the initial read or the `processing` write used to escape as an
    // unhandled rejection inside `after()`, leaving the row stuck in `pending`
    // for ever — the exact zombie the reaper then has to clean up.
    const job = await db.dataExportJob.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, status: true },
    });
    if (!job) return { ok: false, reason: 'job_not_found' };
    if (job.status === 'ready') return { ok: true, reason: 'already_ready' };
    userId = job.userId;

    await db.dataExportJob.update({ where: { id: jobId }, data: { status: 'processing' } });

    const snapshot = await buildUserDataExport(job.userId);
    const mediaKeys = collectMediaKeys(snapshot);
    const target = exportZipPath(jobId);
    const { appended, skipped } = await writeExportZip(target, snapshot, mediaKeys);
    const stat = await fs.stat(target);

    await db.dataExportJob.update({
      where: { id: jobId },
      data: { status: 'ready', resultKey: exportResultKey(jobId), completedAt: new Date() },
    });
    await enqueueDataExportReadyNotification(job.userId, {
      jobId,
      byteSize: stat.size,
      mediaCount: appended,
    });
    await logAudit({
      action: 'account.data.export_job.completed',
      userId: job.userId,
      metadata: {
        jobId,
        byteSize: stat.size,
        mediaAppended: appended,
        mediaSkipped: skipped,
        ...summariseExport(snapshot),
      },
    });
    // Retention — this fresh archive supersedes any older ready one (bounded disk).
    await pruneSupersededExports(job.userId, jobId);
    return { ok: true, byteSize: stat.size, mediaAppended: appended, mediaSkipped: skipped };
  } catch (err) {
    // Reclaim any zip the failed build already flushed BEFORE marking the job
    // `failed`. `writeExportZip` opens the file (and streams the full-PII
    // snapshot) before the `ready` flip, so a throw after that point — or a
    // partial write — strands a full/partial PII archive that no later path
    // reclaims (`pruneSupersededExports` only scans `ready`, the download route
    // 409s a non-ready job). Best-effort + `force:true`, so a never-created file
    // is a no-op. This is the in-process twin of the reaper's zip sweep.
    await removeExportZip(jobId);
    await db.dataExportJob
      .update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      })
      .catch(() => {
        // Best-effort — never mask the original failure with a status-write error
        // (and the row may not exist if the initial read is what threw).
      });
    reportError('account.data.export_job', err instanceof Error ? err : new Error(String(err)), {
      jobId,
    });
    if (userId) {
      await logAudit({
        action: 'account.data.export_job.failed',
        userId,
        metadata: { jobId },
      }).catch(() => {
        // Audit is best-effort in the failure path — never re-throw from here.
      });
    }
    return { ok: false, reason: 'export_failed' };
  }
}

/**
 * Open a read stream on a ready export's zip. Used by the download route
 * handler. Throws `Error('export_not_found')` when the file is missing (job
 * pruned or never completed).
 */
export async function openExportReadStream(
  jobId: string,
): Promise<{ stream: ReadStream; size: number }> {
  const target = exportZipPath(jobId);
  const stat = await fs.stat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new Error('export_not_found');
    throw err;
  });
  return { stream: createReadStream(target), size: stat.size };
}
