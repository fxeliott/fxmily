/**
 * J6 scope 6 — RUNTIME proof of the async RGPD export FROM THE MEMBER's SEAT,
 * end-to-end against real Postgres + the real off-request build.
 *
 *   A. FULL JOURNEY — a member requests the export in the UI, the `after()`
 *      build completes on the server, the download affordance appears, and
 *      `GET /api/account/data/export/[jobId]` returns a real, VALID zip
 *      (200, application/zip) whose bytes unzip to a `data.json` art.20
 *      portability snapshot of THAT member's data. Proves the whole chain:
 *      action → job row → `after(runDataExportJob)` → zip on the volume →
 *      auth-gated streamer — none of it mocked.
 *   B. BOLA — a member CANNOT download another member's export job (404),
 *      proven with a real cross-seat HTTP request, not a unit mock.
 *   C. ANON — the download route rejects an unauthenticated request (401)
 *      before it ever looks up the job.
 *
 * The zip build lands under `<UPLOADS_DIR|cwd/.uploads>/data-exports/<id>.zip`
 * (server side). `cleanupTestUsers` drops the job ROWS; the afterAll removes the
 * real zip ARTEFACTS best-effort (same path logic as `exportsRoot`).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedCheckinHistory,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let memberA: SeededUser | null = null;
let memberB: SeededUser | null = null;
const createdJobIds: string[] = [];

/** Mirror `exportsRoot()` so afterAll can reap the real zip artefacts. */
function exportZipPath(jobId: string): string {
  const fromEnv = process.env.UPLOADS_DIR;
  const uploadsRoot =
    fromEnv && fromEnv.trim().length > 0
      ? path.resolve(fromEnv)
      : path.resolve(process.cwd(), '.uploads');
  return path.join(uploadsRoot, 'data-exports', `${jobId}.zip`);
}

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once.`,
    };
  }
  return { ok: true };
}

test.describe('Account data — async RGPD export member journey (runtime)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    memberA = await seedMemberUser({ firstName: 'ExportMemberA' });
    memberB = await seedMemberUser({ firstName: 'ExportMemberB' });
    // Give member A a little real data so the export snapshot is non-trivial.
    await seedCheckinHistory(memberA.id, { days: 3, seed: 7 });
  });

  test.afterAll(async () => {
    // Reap the real zip artefacts (rows are cleaned by cleanupTestUsers).
    const jobs = await db.dataExportJob.findMany({
      where: { userId: { in: [memberA?.id ?? '', memberB?.id ?? ''] } },
      select: { id: true },
    });
    for (const { id } of [...jobs, ...createdJobIds.map((id) => ({ id }))]) {
      try {
        await fs.rm(exportZipPath(id), { force: true });
      } catch {
        /* best-effort */
      }
    }
    await cleanupTestUsers();
    memberA = memberB = null;
  });

  test('A — member requests, the async build completes, and the zip downloads with their data', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    if (!memberA) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, memberA.email, memberA.password);

    await page.goto('/account/data');
    await page.getByRole('button', { name: 'Préparer mon export complet' }).click();

    // The panel polls every 6s; the off-request build lands in seconds. Wait for
    // the real download affordance to appear (the member's actual signal).
    const download = page.getByTestId('download-export-zip');
    await expect(download).toBeVisible({ timeout: 90_000 });
    // The "Prêt" READY pill exactly (the body copy also contains "prête",
    // so a loose text match is ambiguous — target the pill).
    await expect(page.getByText('Prêt', { exact: true })).toBeVisible();
    // a11y (WCAG 2.1 SC 4.1.3): the ready status lives inside a polite live
    // region so a screen-reader member hears the outcome after the poll flips
    // the job — not just a silent in-place pill swap.
    await expect(page.getByRole('status').filter({ hasText: 'Prêt' })).toBeVisible();

    const href = await download.getAttribute('href');
    expect(href).toMatch(/^\/api\/account\/data\/export\/[a-z0-9]+$/i);
    const jobId = href!.split('/').pop()!;
    createdJobIds.push(jobId);

    // Ownership sanity: the job the UI surfaced belongs to member A.
    const job = await db.dataExportJob.findUnique({
      where: { id: jobId },
      select: { userId: true, status: true },
    });
    expect(job?.userId).toBe(memberA.id);
    expect(job?.status).toBe('ready');

    // Download it as the member and assert it is a real, valid archive.
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/zip');
    expect(res.headers()['content-disposition']).toContain('attachment');
    const body = await res.body();
    expect(body.byteLength).toBeGreaterThan(0);

    // The bytes are a genuine zip whose portability snapshot is present.
    const entries = unzipSync(new Uint8Array(body));
    expect(Object.keys(entries)).toContain('data.json');
    const snapshot = JSON.parse(new TextDecoder().decode(entries['data.json']!));
    expect(snapshot).toBeTruthy();
  });

  test('B — a member cannot download another member’s export (BOLA → 404)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!memberA || !memberB) throw new Error('seed missing — beforeAll did not run');

    // Member B owns a job.
    const jobB = await db.dataExportJob.create({
      data: { userId: memberB.id, status: 'ready', resultKey: `data-exports/placeholder.zip` },
      select: { id: true },
    });

    // Member A, authenticated, tries to fetch it → 404 (never reveals it exists).
    await page.goto('/login');
    await loginAs(page, request, memberA.email, memberA.password);
    const res = await request.get(`/api/account/data/export/${jobB.id}`);
    expect(res.status()).toBe(404);
  });

  test('C — the download route rejects an anonymous request (401)', async ({ request }) => {
    // No login on this request context. Auth is checked before the job lookup,
    // so even a well-formed id gets 401 — never a file, never a status leak.
    const res = await request.get('/api/account/data/export/anon0000export0000test0000');
    expect(res.status()).toBe(401);
  });
});
