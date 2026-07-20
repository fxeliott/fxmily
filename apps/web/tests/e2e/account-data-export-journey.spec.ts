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

    // The download control is a <button> with NO navigable href: no click path
    // (primary, modified, middle, right-click « save as ») can navigate the
    // browser to the raw API URL and dump a JSON error body at the member
    // (posture §2). Encode that guarantee structurally.
    expect(await download.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect(await download.getAttribute('href')).toBeNull();

    // The job the UI surfaced belongs to member A (looked up by owner, since the
    // id is no longer exposed in the DOM).
    const job = await db.dataExportJob.findFirst({
      where: { userId: memberA.id, status: 'ready' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, status: true },
    });
    expect(job?.userId).toBe(memberA.id);
    expect(job?.status).toBe('ready');
    const jobId = job!.id;
    createdJobIds.push(jobId);
    const apiUrl = `/api/account/data/export/${jobId}`;

    // Download it as the member and assert it is a real, valid archive.
    const res = await request.get(apiUrl);
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

    // The button now saves the archive CLIENT-SIDE (fetch → blob), so a
    // pruned/forbidden archive can never dump raw JSON at the member. Prove the
    // real browser click yields a genuine download event, not a navigation.
    const [dl] = await Promise.all([page.waitForEvent('download'), download.click()]);
    expect(dl.suggestedFilename()).toMatch(/^fxmily-export-.+\.zip$/);
    await expect(page).toHaveURL(/\/account\/data$/);
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

  test('D — a pruned archive shows a clean in-panel message, never a raw JSON dump', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);

    // Reach a genuinely ready export the SAME way a member does (mirrors A) — a
    // fresh seat, request in the UI, wait for the real download link. Reaching
    // "ready" via the client poll (not a fresh SSR of an already-ready page)
    // keeps a single download node on the page, so the click is unambiguous.
    const memberD = await seedMemberUser({ firstName: 'ExportMemberD' });
    await page.goto('/login');
    await loginAs(page, request, memberD.email, memberD.password);
    await page.goto('/account/data');
    await page.getByRole('button', { name: 'Préparer mon export complet' }).click();

    const download = page.getByTestId('download-export-zip');
    await expect(download).toBeVisible({ timeout: 90_000 });
    // The id is no longer in the DOM (button, not <a href>) — look up member D's
    // ready job to target the real zip on the volume.
    const jobD = await db.dataExportJob.findFirst({
      where: { userId: memberD.id, status: 'ready' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const jobId = jobD!.id;
    createdJobIds.push(jobId);

    // Simulate the retention / TTL sweep firing AFTER the link was rendered: the
    // zip is gone from the volume but the job row still says "ready" → the route
    // now returns 410 (export_not_found), the exact P3 scenario.
    await fs.rm(exportZipPath(jobId), { force: true });

    // Clicking fetches → 410 → the client shows factual FR copy in the panel and
    // does NOT navigate to the API URL (no raw JSON body at the member). Filter
    // past the empty Next route-announcer (`role="alert"`) to the panel's alert.
    await download.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Ce lien a expiré' })).toBeVisible();
    await expect(page).toHaveURL(/\/account\/data$/);
  });

  test('E — a network failure on download shows the connection message, never an unhandled error', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);

    // Same proven path as D to reach a single, real download link.
    const memberE = await seedMemberUser({ firstName: 'ExportMemberE' });
    await page.goto('/login');
    await loginAs(page, request, memberE.email, memberE.password);
    await page.goto('/account/data');
    await page.getByRole('button', { name: 'Préparer mon export complet' }).click();

    const download = page.getByTestId('download-export-zip');
    await expect(download).toBeVisible({ timeout: 90_000 });
    // Button (no href) — record member E's job id for cleanup via the DB.
    const jobE = await db.dataExportJob.findFirst({
      where: { userId: memberE.id, status: 'ready' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (jobE) createdJobIds.push(jobE.id);

    // Drop the connection entirely (engine-agnostic, unlike `route.abort` which
    // WebKit ignores for same-origin fetch) → the client `fetch` rejects → the
    // `catch` must surface a factual connection message, not an unhandled
    // rejection and not a navigation to a broken URL.
    await page.context().setOffline(true);

    await download.click();
    await expect(page.getByRole('alert').filter({ hasText: 'connexion' })).toBeVisible();
    await expect(page).toHaveURL(/\/account\/data$/);
    await page.context().setOffline(false);
  });

  test('F — keyboard focus stays on the panel after a status transition (WCAG 2.4.3)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const memberF = await seedMemberUser({ firstName: 'ExportMemberF' });
    await page.goto('/login');
    await loginAs(page, request, memberF.email, memberF.password);
    await page.goto('/account/data');

    // A keyboard member activates the primary action. `pending` flips true on the
    // next render → the native `disabled` attribute would blur the focused button
    // to <body> for the whole ~1-2s round-trip, and it then UNMOUNTS on the status
    // change (WCAG 2.4.3 Focus Order). The fix moves focus to the panel heading
    // SYNCHRONOUSLY, so focus must already be on the heading right after the
    // keypress — NOT stranded on <body> during the in-flight window.
    const prepare = page.getByRole('button', { name: 'Préparer mon export complet' });
    await expect(prepare).toBeVisible();
    await prepare.focus();
    await prepare.press('Enter');

    // In-flight anchor: focus reaches the heading almost immediately (the
    // synchronous move), well before the round-trip lands the "On assemble" copy.
    // The short poll passes on the fixed code; the pre-fix version sat on <body>
    // during this window.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? null), {
        timeout: 2500,
        intervals: [50, 100, 150, 250, 400],
      })
      .toBe('H3');
    const focusedText = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent ?? '',
    );
    expect(focusedText).toContain('Export complet');
    // And the in-flight state is actually reached (the action registered).
    await expect(page.getByText('On assemble ton archive')).toBeVisible({ timeout: 30_000 });

    const jobF = await db.dataExportJob.findFirst({
      where: { userId: memberF.id },
      select: { id: true },
    });
    if (jobF) createdJobIds.push(jobF.id);
  });
});
