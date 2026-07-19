import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateAvatarKey } from '@/lib/storage/keys';

/**
 * J6 (admin-scale, scope 6) — the "Done quand" proof for the asynchronous RGPD
 * export: an archive **generated OUT of the HTTP request** that **includes the
 * member's media**, streamed to disk (no whole-buffer in RAM), then re-openable
 * by the download route.
 *
 * This exercises the STANDALONE `runDataExportJob(jobId)` entry point directly
 * (exactly what `after()` calls in production) with the persistence layer mocked
 * — no Postgres — while keeping the storage/filesystem/zip path REAL. The zip is
 * then re-read via the production `openExportReadStream` (the download route's
 * core) and unzipped with `fflate` to assert both `data.json` and the seeded
 * photo are present with byte-exact content.
 */

const { JOB_ID, USER_ID } = vi.hoisted(() => ({
  JOB_ID: 'testjob0001',
  USER_ID: 'testuser01',
}));

// Capture the persistence side effects without a DB.
const dbUpdateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
const enqueueCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

vi.mock('@/lib/db', () => ({
  db: {
    dataExportJob: {
      findUnique: vi.fn(async () => ({ id: JOB_ID, userId: USER_ID, status: 'pending' })),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        dbUpdateCalls.push(args);
        return { id: JOB_ID };
      }),
      // Retention prune (older ready jobs) + zombie reaper. Default to a no-op
      // shape; individual tests override via `mockResolvedValueOnce`.
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

// The snapshot builder is exercised by its own suite; here we inject a tiny,
// deterministic snapshot that carries exactly one valid media key.
vi.mock('@/lib/account/export', () => ({
  buildUserDataExport: vi.fn(),
  summariseExport: vi.fn(() => ({ sections: 1 })),
}));

vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDataExportReadyNotification: vi.fn(
    async (userId: string, payload: Record<string, unknown>) => {
      enqueueCalls.push({ userId, payload });
      return 'notif-id';
    },
  ),
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

// Imported AFTER the mocks are registered (vi.mock is hoisted above imports).
import { buildUserDataExport } from '@/lib/account/export';
import { db } from '@/lib/db';
import {
  exportResultKey,
  openExportReadStream,
  reapStaleExportJobs,
  removeExportZip,
  runDataExportJob,
  STALE_EXPORT_JOB_MS,
} from '@/lib/account/export-archive';
import { localUploadPathFor } from '@/lib/storage';
import type { UserDataExport } from '@/lib/account/export';

const MEDIA_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
]);

let tmpUploads: string;
let avatarKey: string;
let snapshot: UserDataExport;

async function drainZip(): Promise<Record<string, Uint8Array>> {
  const { stream } = await openExportReadStream(JOB_ID);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return unzipSync(new Uint8Array(Buffer.concat(chunks)));
}

describe('runDataExportJob (async RGPD export, J6 scope 6)', () => {
  beforeAll(async () => {
    tmpUploads = await fs.mkdtemp(path.join(os.tmpdir(), 'fxmily-export-'));
    process.env.UPLOADS_DIR = tmpUploads;

    // Seed a real media file on the (temp) uploads volume under a valid key.
    avatarKey = generateAvatarKey(USER_ID, 'image/png');
    const mediaPath = localUploadPathFor(avatarKey);
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, MEDIA_BYTES);

    // A minimal snapshot whose ONLY storage-key-shaped value is the avatar. A
    // free-text field is included to prove `collectMediaKeys` never mistakes
    // prose for a key.
    snapshot = {
      account: { avatarKey },
      reflections: [{ note: 'Just some prose, not a key: avatars are cool.' }],
    } as unknown as UserDataExport;
    vi.mocked(buildUserDataExport).mockResolvedValue(snapshot);
  });

  afterAll(async () => {
    if (tmpUploads) await fs.rm(tmpUploads, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('builds a zip off-request with data.json + the member media, and marks the job ready', async () => {
    const result = await runDataExportJob(JOB_ID);

    // 1. The standalone run succeeded and appended exactly the one media.
    expect(result.ok).toBe(true);
    expect(result.mediaAppended).toBe(1);
    expect(result.mediaSkipped).toBe(0);
    expect(result.byteSize).toBeGreaterThan(0);

    // 2. The job was flipped processing → ready with a result key (never HTTP).
    const statuses = dbUpdateCalls.map((c) => c.data.status);
    expect(statuses).toEqual(['processing', 'ready']);
    const readyCall = dbUpdateCalls.at(-1);
    expect(readyCall?.data.resultKey).toBe(exportResultKey(JOB_ID));
    expect(readyCall?.data.completedAt).toBeInstanceOf(Date);

    // 3. The member is notified with the true media count + byte size.
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.userId).toBe(USER_ID);
    expect(enqueueCalls[0]?.payload).toMatchObject({
      jobId: JOB_ID,
      byteSize: result.byteSize,
      mediaCount: 1,
    });

    // 4. Re-open via the download route's core + unzip: BOTH entries present.
    const files = await drainZip();
    expect(Object.keys(files)).toContain('data.json');
    expect(Object.keys(files)).toContain(`media/${avatarKey}`);

    // 5. data.json round-trips to the exact snapshot.
    const parsed = JSON.parse(new TextDecoder().decode(files['data.json']));
    expect(parsed).toEqual(snapshot);

    // 6. The media bytes are byte-identical (real photo, not a placeholder).
    expect(Array.from(files[`media/${avatarKey}`] ?? [])).toEqual(Array.from(MEDIA_BYTES));
  });

  it('is idempotent on an already-ready job (no duplicate archive work)', async () => {
    const { db } = await import('@/lib/db');
    vi.mocked(db.dataExportJob.findUnique).mockResolvedValueOnce({
      id: JOB_ID,
      userId: USER_ID,
      status: 'ready',
    } as never);

    const before = dbUpdateCalls.length;
    const result = await runDataExportJob(JOB_ID);
    expect(result).toEqual({ ok: true, reason: 'already_ready' });
    // No further status writes on a ready job.
    expect(dbUpdateCalls.length).toBe(before);
  });
});

/**
 * J6 scope 6 hardening (adversarial-review fixes): zombie reaper + per-member
 * retention prune + the RGPD-erasure-shared `removeExportZip` primitive. These
 * keep the filesystem + volume side of the export lifecycle honest at scale.
 */
describe('export lifecycle helpers (reaper + retention + zip removal)', () => {
  let tmp2: string;
  let exportsDir: string;
  const JOB_ID2 = 'testjob0002';

  beforeAll(async () => {
    tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fxmily-export-life-'));
    process.env.UPLOADS_DIR = tmp2;
    exportsDir = path.join(tmp2, 'data-exports');
    await fs.mkdir(exportsDir, { recursive: true });
    // No media keys — these tests only care about the job lifecycle, not media.
    vi.mocked(buildUserDataExport).mockResolvedValue({
      account: { id: USER_ID },
    } as unknown as UserDataExport);
  });

  afterAll(async () => {
    if (tmp2) await fs.rm(tmp2, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  beforeEach(() => {
    vi.mocked(db.dataExportJob.findMany)
      .mockReset()
      .mockResolvedValue([] as never);
    vi.mocked(db.dataExportJob.deleteMany)
      .mockReset()
      .mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.dataExportJob.updateMany)
      .mockReset()
      .mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.dataExportJob.findUnique)
      .mockReset()
      .mockResolvedValue({ id: JOB_ID2, userId: USER_ID, status: 'pending' } as never);
  });

  it('removeExportZip deletes an existing zip, no-ops a missing file, refuses a bad id', async () => {
    const f = path.join(exportsDir, 'abc123.zip');
    await fs.writeFile(f, new Uint8Array([1, 2, 3]));

    expect(await removeExportZip('abc123')).toBe(true);
    await expect(fs.access(f)).rejects.toThrow(); // actually gone

    // A malformed id can never be turned into a path (traversal-safe).
    expect(await removeExportZip('../etc/passwd')).toBe(false);
    // A missing file is a benign no-op (force rm resolves).
    expect(await removeExportZip('missing999')).toBe(true);
  });

  it('reapStaleExportJobs flips only sufficiently-old pending/processing jobs to failed', async () => {
    const now = new Date('2026-07-19T12:00:00.000Z');
    vi.mocked(db.dataExportJob.updateMany).mockResolvedValueOnce({ count: 2 } as never);

    const reaped = await reapStaleExportJobs(USER_ID, now);
    expect(reaped).toBe(2);

    const args = vi.mocked(db.dataExportJob.updateMany).mock.calls.at(-1)?.[0] as {
      where: { userId: string; status: { in: string[] }; createdAt: { lt: Date } };
      data: { status: string };
    };
    expect(args.where.userId).toBe(USER_ID);
    expect(args.where.status).toEqual({ in: ['pending', 'processing'] });
    // Threshold is exactly `now - STALE_EXPORT_JOB_MS` — a fresher job is spared.
    expect(args.where.createdAt.lt.getTime()).toBe(now.getTime() - STALE_EXPORT_JOB_MS);
    expect(args.data.status).toBe('failed');
  });

  it('reapStaleExportJobs never throws (returns 0 on a DB error)', async () => {
    vi.mocked(db.dataExportJob.updateMany).mockRejectedValueOnce(new Error('db down'));
    await expect(reapStaleExportJobs(USER_ID)).resolves.toBe(0);
  });

  it('prunes an older ready export (zip file + row) when a fresh one completes', async () => {
    // Seed a stale ready zip belonging to a superseded job.
    const oldZip = path.join(exportsDir, 'oldjob0003.zip');
    await fs.writeFile(oldZip, new Uint8Array([9, 9, 9]));
    // The prune query returns that one superseded job.
    vi.mocked(db.dataExportJob.findMany).mockResolvedValueOnce([{ id: 'oldjob0003' }] as never);

    const result = await runDataExportJob(JOB_ID2);
    expect(result.ok).toBe(true);

    // The superseded row is deleted...
    const del = vi.mocked(db.dataExportJob.deleteMany).mock.calls.at(-1)?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(del.where.id.in).toEqual(['oldjob0003']);
    // ...and its zip is physically gone from the volume.
    await expect(fs.access(oldZip)).rejects.toThrow();
    // The NEW job's archive was written and is still present.
    await expect(fs.access(path.join(exportsDir, `${JOB_ID2}.zip`))).resolves.toBeUndefined();
  });

  it('a prune failure never fails the export the member just completed', async () => {
    vi.mocked(db.dataExportJob.findMany).mockRejectedValueOnce(new Error('prune query down'));
    const result = await runDataExportJob(JOB_ID2);
    // The export itself still succeeds (prune is best-effort housekeeping).
    expect(result.ok).toBe(true);
  });

  it('keeps the superseded row when its zip removal fails (art.17 sweep can still reap it)', async () => {
    // Seed a superseded ready zip, then make the physical delete of it fail with
    // a real I/O error. The DB row MUST survive: the account-erasure sweep
    // (`deletion.ts`) only iterates existing `DataExportJob` rows, so dropping
    // the row while the full-PII zip lingers would strand it past an art.17
    // erasure. `fs.rm` is the only rm in the module, and on the success path it
    // is reached solely via the prune's `removeExportZip`.
    const stuckZip = path.join(exportsDir, 'stuckjob04.zip');
    await fs.writeFile(stuckZip, new Uint8Array([7, 7, 7]));
    vi.mocked(db.dataExportJob.findMany).mockResolvedValueOnce([{ id: 'stuckjob04' }] as never);
    const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('EIO: volume down'));

    const result = await runDataExportJob(JOB_ID2);
    expect(result.ok).toBe(true); // prune is best-effort — the export still succeeds

    // No deleteMany call carried the stuck id → its pointer row is preserved...
    const deletedStuck = vi.mocked(db.dataExportJob.deleteMany).mock.calls.some((c) => {
      const w = c[0] as { where?: { id?: { in?: string[] } } } | undefined;
      return w?.where?.id?.in?.includes('stuckjob04') ?? false;
    });
    expect(deletedStuck).toBe(false);
    // ...and the orphan zip is still on the volume, reapable by a later erase.
    await expect(fs.access(stuckZip)).resolves.toBeUndefined();

    rmSpy.mockRestore();
  });
});
