/**
 * E2E — client integer guards on the sibling check-in fields, from the member seat.
 *
 * Sibling of `meditation-bound.spec.ts` (#537). PR #539 added a `!Number.isInteger`
 * client guard to two fields whose server schema is `.int()` — morning
 * `sportDurationMin` (`.int().min(0).max(600)`) and evening `caffeineMl`
 * (`.int().min(0).max(2000)`). Before the guard, a decimal like "30,5" / "250,5"
 * passed the client range check then got rejected server-side ("Entier requis.").
 * This drives the real routed wizards as a seeded member and proves, at runtime:
 *   1. a decimal sport duration is rejected inline and blocks the Corps step;
 *   2. an integer sport duration advances to Mental;
 *   3. a decimal caffeine value is rejected inline and blocks the Hydratation step;
 *   4. an integer caffeine value advances to Stress.
 *
 * Pre-requisites identical to `checkin-happy-path.spec.ts` (Postgres up,
 * migrations applied, env DATABASE_URL / AUTH_SECRET / AUTH_URL). No real
 * credentials: `seedMemberUser` creates an ephemeral test member.
 *
 * Text assertions use regex (not string literals) — the guardrail-sanctioned
 * matcher (`check-e2e-copy-sync.mjs` skips regex by design), consistent with
 * `meditation-bound.spec.ts`.
 */

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

/**
 * Drive Sommeil + Routine matinale so the morning wizard lands on "Corps"
 * (the sport fields live there). Mirrors `meditation-bound.spec.ts`. Meditation
 * defaults to a valid integer, so only the sport field can block this step.
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

/** Drive Discipline so the evening wizard lands on "Hydratation & caféine". */
async function gotoHydrationStep(page: Page): Promise<void> {
  await page.goto('/checkin/evening');
  await expect(page).toHaveURL(/\/checkin\/evening/);
  await page.locator('label').filter({ hasText: /^Oui$/i }).first().click(); // planRespectedToday → Oui
  await page
    .locator('label')
    .filter({ hasText: /^N\/A$/i })
    .first()
    .click(); // hedgeRespectedToday → N/A
  await page.getByRole('button', { name: /Suivant/i }).click();
  await expect(page.getByRole('heading', { name: /Hydratation/i })).toBeVisible();
}

test.describe('PR #539 — sibling integer guards from the member seat', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    seeded = await seedMemberUser({ firstName: 'Sasha' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('rejects a decimal sport duration inline and blocks the Corps step', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoBodyStep(page);

    // Both sport fields must be filled, else the type<->duration pairing error
    // fires first and masks the integer guard.
    await page.getByLabel(/Type de sport/i).fill('Course');
    await page.getByLabel(/Durée du sport/i).fill('30.5');
    await page.getByRole('button', { name: /Suivant/i }).click();

    await expect(page.getByText(/Minutes entières uniquement\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Corps/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mental/i })).toHaveCount(0);
  });

  test('accepts an integer sport duration and advances to Mental', async ({ page, request }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoBodyStep(page);

    await page.getByLabel(/Type de sport/i).fill('Course');
    await page.getByLabel(/Durée du sport/i).fill('30');
    await page.getByRole('button', { name: /Suivant/i }).click();

    await expect(page.getByRole('heading', { name: /Mental/i })).toBeVisible();
  });

  test('rejects a decimal caffeine value inline and blocks the Hydratation step', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoHydrationStep(page);

    await page.getByLabel(/Caféine totale/i).fill('250.5');
    await page.getByRole('button', { name: /Suivant/i }).click();

    await expect(page.getByText(/Millilitres entiers uniquement\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Hydratation/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Stress/i })).toHaveCount(0);
  });

  test('accepts an integer caffeine value and advances to Stress', async ({ page, request }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);
    await gotoHydrationStep(page);

    await page.getByLabel(/Caféine totale/i).fill('300');
    await page.getByRole('button', { name: /Suivant/i }).click();

    await expect(page.getByRole('heading', { name: /Stress/i })).toBeVisible();
  });
});
