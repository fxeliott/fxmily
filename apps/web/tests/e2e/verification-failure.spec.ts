/**
 * J4.6 — E2E for the verification failure UX (J4.1 persist → J4.2 render).
 *
 * A terminally-refused MT5 proof carries a `ProofFailureReason`; `/verification`
 * must render the calm, specific explanation (label + instruction) plus a
 * re-upload CTA back to the mounted uploader — the « miroir, pas sanction »
 * posture, not a generic « Lecture impossible ».
 *
 * Scar GG-CI: NEVER import a `'server-only'` module here (e.g.
 * `lib/verification/service.ts`). We seed Prisma directly via `@/lib/db` and the
 * pure test helpers, which carry no `'server-only'` marker.
 *
 * Determinism: NO `waitForLoadState('networkidle')` (Turbopack dev keeps an HMR
 * socket open → never idle → flaky). `goto` awaits `load`; `toBeVisible`
 * auto-waits. Skips cleanly with a clear message if Chromium is not installed.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

test.describe('J4 verification failure UX — reject → explain → re-upload', () => {
  let member: SeededUser;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');
  });

  test.beforeEach(async () => {
    await cleanupTestUsers();
    member = await seedMemberUser();
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
  });

  test('a terminally-refused proof shows the specific reason + a re-upload CTA', async ({
    page,
    request,
  }) => {
    // Seed a proof the vision pipeline terminally refused as « not an MT5
    // history » (J4.1 persists failureReason='NOT_MT5_SCREEN'). `filePurgedAt`
    // is stamped so the thumbnail renders a placeholder — no storage read needed.
    await db.mt5AccountProof.create({
      data: {
        memberId: member.id,
        fileKey: `proofs/${member.id}/abcdefghijklmnop.jpg`,
        fileHash: 'deadbeef'.repeat(8),
        ocrStatus: 'failed',
        failureReason: 'NOT_MT5_SCREEN',
        filePurgedAt: new Date(),
      },
    });

    await loginAs(page, request, member.email, member.password);
    await page.goto('/verification');

    // 1) The calm, specific explanation (label + instruction) from
    //    FAILURE_REASON_COPY.NOT_MT5_SCREEN is visible.
    await expect(page.getByText("Ce n'était pas un historique MT5")).toBeVisible();
    await expect(
      page.getByText("Envoie une capture de l'onglet Historique de ton compte MT5."),
    ).toBeVisible();

    // 2) The re-upload path is offered: an anchor back to the mounted uploader.
    const reupload = page.locator('a[href="#proof-uploader"]');
    await expect(reupload).toBeVisible();
    await expect(reupload).toHaveText(/Renvoyer une capture/);
  });
});
