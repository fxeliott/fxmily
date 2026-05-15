/**
 * Full happy-path E2E for the J5 daily check-in flow.
 *
 * Cross-jalon helper milestone: this is the first E2E that goes beyond
 * "auth gate works on a public surface" — it seeds a real member, logs them
 * in, drives the morning wizard end-to-end, asserts the DB state, and
 * cleans up. Future jalons (J6 track record, J9 push) can extend the same
 * `db-helpers` + `loginAs` foundation.
 *
 * Pre-requisites:
 *   - Postgres `fxmily-postgres-dev` up (docker compose).
 *   - `apps/web/.env` populated with DATABASE_URL + AUTH_SECRET + AUTH_URL.
 *   - All migrations applied (J1 init + J2 trade + J4 annotation + J5 +
 *     J5_dedup).
 *
 * Run (skipped automatically by the suite when DB env is missing):
 *   pnpm --filter @fxmily/web test:e2e checkin-happy-path
 */

import { expect, test } from '@playwright/test';

import { localDateOf } from '@/lib/checkin/timezone';
import {
  cleanupTestUsers,
  getLatestCheckin,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

test.describe('J5 — checkin happy path', () => {
  test.beforeEach(async () => {
    // Idempotent — if a previous run crashed, remnants are cleaned up here.
    await cleanupTestUsers();
    seeded = await seedMemberUser({ firstName: 'Eve' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('member submits morning check-in and the streak increments to 1', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    // Log in via the real Auth.js callback.
    await page.goto('/'); // initialise the browser context against baseURL
    await loginAs(page, request, seeded.email, seeded.password);

    // Navigate to the morning wizard.
    await page.goto('/checkin/morning');
    await expect(page).toHaveURL(/\/checkin\/morning/);
    await expect(page.getByRole('heading', { name: /Sommeil/i })).toBeVisible();

    // ─── Step 1 (Sommeil) ───────────────────────────────────────────────
    await page.getByLabel(/Heures de sommeil/i).fill('7.5');
    // SleepZonesBar lights up — the "Cible" zone label appears live.
    // (Don't strictly assert visibility because the sm:inline label may be
    // hidden at iPhone 15 width — assert the readout instead.)
    await page.getByRole('button', { name: /Suivant/i }).click();

    // ─── Step 2 (Routine matinale) ─────────────────────────────────────
    await expect(page.getByRole('heading', { name: /Routine matinale/i })).toBeVisible();
    // Radios are visually-hidden (`sr-only`) — click the wrapping <label>
    // text instead of trying to drive the input directly.
    await page.locator('label').filter({ hasText: /^Oui$/i }).first().click();
    await page.getByRole('button', { name: /Suivant/i }).click();

    // ─── Step 3 (Corps) ─────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /Corps/i })).toBeVisible();
    // meditationMin defaults to "0", sport optional — leave both alone.
    await page.getByRole('button', { name: /Suivant/i }).click();

    // ─── Step 4 (Mental) ───────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /Mental/i })).toBeVisible();
    // Mood defaults to 6 — submitable as-is.
    await page.getByRole('button', { name: /Suivant/i }).click();

    // ─── Step 5 (Intention) — submit ───────────────────────────────────
    await expect(page.getByRole('heading', { name: /Intention du jour/i })).toBeVisible();
    await page.getByRole('button', { name: /Enregistrer mon matin/i }).click();

    // ─── Verify redirect + confirm-flash banner ────────────────────────
    await expect(page).toHaveURL(/\/checkin\?slot=morning&done=1/);
    await expect(page.getByRole('status').first()).toContainText(/Check-in matin enregistré/i);
    await expect(page.getByRole('status').first()).toContainText(/streak 1 jour/i);

    // ─── Verify DB state ───────────────────────────────────────────────
    // Anchor `today` to the member's Europe/Paris civil date — the app
    // stores DailyCheckin.date as @db.Date in the member's local timezone
    // (J5 design, see lib/checkin/timezone.ts), NOT UTC. A plain
    // `new Date().toISOString()` would query the UTC date and miss the row
    // every night in the ~22:00–00:00 UTC window (Paris already next day),
    // a deterministic wall-clock flake.
    const today = localDateOf(new Date(), 'Europe/Paris');
    const row = await getLatestCheckin(seeded.id, today, 'morning');
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      slot: 'morning',
      sleepHours: '7.5', // Prisma Decimal(4,2) trims trailing zeros on read
      sleepQuality: 6,
      morningRoutineCompleted: true,
      meditationMin: 0,
      moodScore: 6,
    });
  });

  test('streak still 1 after submitting evening too the same day', async ({ page, request }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    // Same flow, but submit evening directly to verify streak counter
    // collapses morning + evening into one filled day.
    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);

    // Step 1 — log a morning first by hitting the Server Action via the
    // wizard (faster than driving 5 steps; we already cover the wizard
    // flow above).
    await page.goto('/checkin/morning');
    await page.getByLabel(/Heures de sommeil/i).fill('8');
    await page.getByRole('button', { name: /Suivant/i }).click();
    // Radios are visually-hidden (`sr-only`) — click the wrapping <label>
    // text instead of trying to drive the input directly.
    await page.locator('label').filter({ hasText: /^Oui$/i }).first().click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.getByRole('button', { name: /Enregistrer mon matin/i }).click();
    await expect(page).toHaveURL(/\/checkin/);

    // Step 2 — go submit evening.
    await page.goto('/checkin/evening');
    await page.locator('label').filter({ hasText: /^Oui$/i }).first().click();
    await page
      .locator('label')
      .filter({ hasText: /^N\/A$/i })
      .first()
      .click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    // Hydratation step — leave optional fields empty.
    await page.getByRole('button', { name: /Suivant/i }).click();
    // Stress step — default 5.
    await page.getByRole('button', { name: /Suivant/i }).click();
    // Mental step — default mood 6.
    await page.getByRole('button', { name: /Suivant/i }).click();
    // Réflexion — submit.
    await page.getByRole('button', { name: /Enregistrer ma soirée/i }).click();

    await expect(page).toHaveURL(/\/checkin\?slot=evening&done=1/);
    await expect(page.getByRole('status').first()).toContainText(/streak 1 jour/i);

    // DB sanity: morning + evening rows both exist.
    // Anchor `today` to the member's Europe/Paris civil date — the app
    // stores DailyCheckin.date as @db.Date in the member's local timezone
    // (J5 design, see lib/checkin/timezone.ts), NOT UTC. A plain
    // `new Date().toISOString()` would query the UTC date and miss the row
    // every night in the ~22:00–00:00 UTC window (Paris already next day),
    // a deterministic wall-clock flake.
    const today = localDateOf(new Date(), 'Europe/Paris');
    const m = await getLatestCheckin(seeded.id, today, 'morning');
    const e = await getLatestCheckin(seeded.id, today, 'evening');
    expect(m).not.toBeNull();
    expect(e).not.toBeNull();
    expect(e).toMatchObject({
      slot: 'evening',
      planRespectedToday: true,
      hedgeRespectedToday: null, // 'na' → null
      moodScore: 6,
      stressScore: 5,
    });
  });
});
