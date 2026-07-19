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
  const job = await db.dataExportJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true },
  });
  if (!job) return { ok: false, reason: 'job_not_found' };
  if (job.status === 'ready') return { ok: true, reason: 'already_ready' };

  await db.dataExportJob.update({ where: { id: jobId }, data: { status: 'processing' } });

  try {
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
    return { ok: true, byteSize: stat.size, mediaAppended: appended, mediaSkipped: skipped };
  } catch (err) {
    await db.dataExportJob
      .update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      })
      .catch(() => {
        // Best-effort — never mask the original failure with a status-write error.
      });
    reportError('account.data.export_job', err instanceof Error ? err : new Error(String(err)), {
      jobId,
    });
    await logAudit({
      action: 'account.data.export_job.failed',
      userId: job.userId,
      metadata: { jobId },
    });
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
