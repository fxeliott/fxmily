/**
 * E2E — meditation duration bound (180) enforced from the member's seat.
 *
 * Closes the coverage gap left by PR #536 (the J5.2 divergence fix: morning
 * check-in cap 240 -> 180, single-source `MEDITATION_MAX_MIN`). That fix had
 * unit + integration tests but no member-perspective E2E. This drives the real
 * morning wizard as a seeded member and proves, at runtime, the three
 * behaviours the fix guarantees:
 *   1. typing a meditation > 180 is rejected inline and blocks the step;
 *   2. exactly 180 is accepted and persisted as 180;
 *   3. a legacy over-bound stored value (200, pre-fix data) is clamped to 180
 *      on the edit prefill — the member never faces an unsavable form.
 *
 * Pre-requisites are identical to `checkin-happy-path.spec.ts` (Postgres up,
 * migrations applied, env with DATABASE_URL / AUTH_SECRET / AUTH_URL).
 */

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

import { localDateOf } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  getLatestCheckin,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

/**
 * Drive steps 1-2 (Sommeil + Routine matinale) so the wizard lands on the
 * "Corps" step, where the meditation field lives. Mirrors the navigation in
 * `checkin-happy-path.spec.ts`. Idempotent under edit-mode prefill: re-filling
 * sleep overwrites, and re-clicking an already-selected "Oui" radio is a no-op.
 */
async function gotoBodyStep(page: Page): Promise<void> {
  await page.goto('/checkin/morning');
  await expect(page).toHaveURL(/\/checkin\/morning/);
  await page.getByLabel(/Heures de sommeil/i).fill('7.5');
  await page.getByRole('button', { name: /Suivant/i }).click();
  await page
    .getByRole('group', { name: /routine matinale/i })
    .locator('label')
    .filter({ hasText: /^Oui$/i })
    .click();
  await page
    .getByRole('group', { name: /analyse de marché/i })
    .locator('label')
    .filter({ hasText: /^Oui$/i })
    .click();
  await page.getByRole('button', { name: /Suivant/i }).click();
  await expect(page.getByRole('heading', { name: /Corps/i })).toBeVisible();
}

test.describe('J5.2 — meditation bound (180) from the member seat', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    seeded = await seedMemberUser({ firstName: 'Mira' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('rejects a meditation above 180 and blocks the step', async ({ page, request }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoBodyStep(page);

    await page.getByLabel(/Méditation/i).fill('200');
    await page.getByRole('button', { name: /Suivant/i }).click();

    // Inline error is shown and the step does NOT advance (still on Corps,
    // the Mental step never renders). Regex (not a string literal) because the
    // source copy is dynamic — `Entre 0 et ${MEDITATION_MAX_MIN} min.` — so the
    // 180 is interpolated at runtime, not present verbatim in src. A stable
    // regex is the guardrail-sanctioned matcher for interpolated copy
    // (check-e2e-copy-sync.mjs skips regex assertions by design).
    await expect(page.getByText(/Entre 0 et 180 min\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Corps/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mental/i })).toHaveCount(0);
  });

  test('accepts exactly 180 and persists it', async ({ page, request }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoBodyStep(page);

    await page.getByLabel(/Méditation/i).fill('180');
    await page.getByRole('button', { name: /Suivant/i }).click(); // -> Mental
    await expect(page.getByRole('heading', { name: /Mental/i })).toBeVisible();
    await page.getByRole('button', { name: /Suivant/i }).click(); // -> Intention
    await expect(page.getByRole('heading', { name: /Intention du jour/i })).toBeVisible();
    await page.getByRole('button', { name: /Enregistrer mon matin/i }).click();
    await expect(page).toHaveURL(/\/checkin\?slot=morning&done=1/);

    const today = localDateOf(new Date(), 'Europe/Paris');
    const row = await getLatestCheckin(seeded.id, today, 'morning');
    expect(row).toMatchObject({ slot: 'morning', meditationMin: 180 });
  });

  test('clamps a legacy over-bound stored value to 180 on edit prefill', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);

    // Submit a valid morning (180) so today's row exists.
    await gotoBodyStep(page);
    await page.getByLabel(/Méditation/i).fill('180');
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.getByRole('button', { name: /Enregistrer mon matin/i }).click();
    await expect(page).toHaveURL(/\/checkin\?slot=morning&done=1/);

    // Simulate PRE-FIX legacy data: force the stored value above the bound,
    // straight past the schema (a row created when the cap was still 240).
    const { count } = await db.dailyCheckin.updateMany({
      where: { userId: seeded.id, slot: 'morning' },
      data: { meditationMin: 200 },
    });
    expect(count).toBe(1);

    // Re-open the wizard in edit mode -> the prefill must clamp 200 -> 180,
    // so the member sees a value their now-180 validation accepts.
    await gotoBodyStep(page);
    await expect(page.getByLabel(/Méditation/i)).toHaveValue('180');
  });
});
