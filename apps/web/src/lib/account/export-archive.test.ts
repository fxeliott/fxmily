import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import {
  exportResultKey,
  openExportReadStream,
  runDataExportJob,
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
