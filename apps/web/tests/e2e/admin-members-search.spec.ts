import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S7 (verification pass) — admin members directory SEARCH, exercised end-to-end
 * against real Postgres through the real UI. Proves the S7-optimization
 * deliverable: the admin can find a member instantly by name at cohort scale
 * (the list is server-filtered, not just client-hidden), and clearing the
 * search restores the full cohort. Cursor-pagination math is unit-tested in
 * `lib/admin/members-service.test.ts`; this asserts the runtime behaviour.
 *
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, no `networkidle`.
 */

let admin: SeededUser | null = null;
let alpha: SeededUser | null = null;
let bravo: SeededUser | null = null;

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

test.describe('S7 — Espace Admin : recherche annuaire membres', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'SrchAdmin' });
    // Distinctive, collision-proof first names so the ILIKE filter is
    // unambiguous regardless of any other rows in the dev DB.
    alpha = await seedMemberUser({ firstName: 'Alphawolf' });
    bravo = await seedMemberUser({ firstName: 'Bravobear' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    alpha = null;
    bravo = null;
  });

  test('la recherche filtre la liste cote serveur, puis Effacer la restaure', async ({
    page,
    request,
  }) => {
    if (!admin || !alpha || !bravo) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    const alphaRow = `main a[href$="/admin/members/${alpha.id}"]`;
    const bravoRow = `main a[href$="/admin/members/${bravo.id}"]`;

    // Unfiltered: both seeded members are reachable.
    await page.goto('/admin/members');
    await expect(page.locator(alphaRow)).toBeVisible();
    await expect(page.locator(bravoRow)).toBeVisible();

    // Search by Alpha's distinctive first name → only Alpha remains (server
    // filter: Bravo's row is GONE from the DOM, not merely hidden).
    await page.goto('/admin/members?q=Alphawolf');
    await expect(page.locator(alphaRow)).toBeVisible();
    await expect(page.locator(bravoRow)).toHaveCount(0);
    await expect(page.getByText(/Résultats pour/)).toBeVisible();

    // Clear restores the full cohort.
    await page.getByRole('link', { name: 'Effacer la recherche' }).click();
    await expect(page).toHaveURL(/\/admin\/members(\?.*)?$/);
    await expect(page.locator(alphaRow)).toBeVisible();
    await expect(page.locator(bravoRow)).toBeVisible();
  });

  test('une recherche sans correspondance affiche un etat vide calme', async ({
    page,
    request,
  }) => {
    if (!admin) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto('/admin/members?q=zzzznomatchzzzz');
    await expect(page.getByText(/Aucun membre ne correspond/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Réinitialiser la recherche' })).toBeVisible();
  });
});
