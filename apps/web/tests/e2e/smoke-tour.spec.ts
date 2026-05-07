/**
 * Visual smoke-tour: full member journey with screenshots at each
 * meaningful state, for design review / onboarding docs / regression
 * comparison across jalons.
 *
 * Run with `PLAYWRIGHT_CAPTURE=all` to keep screenshots even when the
 * test passes. Output goes to `apps/web/test-results/captures/`.
 *
 * NOT a behavioural test — assertions kept minimal so the captures are
 * the deliverable. The behavioural coverage lives in
 * `checkin-happy-path.spec.ts`.
 */

import { test } from '@playwright/test';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

test.describe('Visual smoke-tour — member full journey', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    seeded = await seedMemberUser({ firstName: 'Eve', lastName: 'Smoke' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('login → dashboard → morning → checkin landing → evening → final', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');

    // ─── 1) Login page (unauthenticated) ─────────────────────────────────
    await page.goto('/login');
    await page.screenshot({
      path: 'test-results/captures/tour-01-login-page.png',
      fullPage: true,
    });

    // ─── 2) Auth.js Credentials flow → /dashboard ───────────────────────
    await loginAs(page, request, seeded.email, seeded.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-02-dashboard-empty-state.png',
      fullPage: true,
    });

    // ─── 3) /checkin landing — empty streak ─────────────────────────────
    await page.goto('/checkin');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-03-checkin-landing-empty.png',
      fullPage: true,
    });

    // ─── 4) Wizard matin — Step 1 Sommeil ───────────────────────────────
    // <input type="number"> rejects comma at DOM level — Playwright `fill`
    // can't insert "7,5". The FR comma path is exercised in the unit tests
    // (parseLocaleNumber), at the network/server-action layer where it
    // matters. For the visual tour we use the dot form.
    await page.goto('/checkin/morning');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/Heures de sommeil/i).fill('7.5');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: 'test-results/captures/tour-04-morning-step1-sommeil.png',
      fullPage: true,
    });

    // Steps 2 → 5 (drive through quickly with default values)
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'test-results/captures/tour-05-morning-step2-routine.png',
      fullPage: true,
    });

    await page.locator('label').filter({ hasText: /^Oui$/i }).first().click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'test-results/captures/tour-06-morning-step3-corps.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'test-results/captures/tour-07-morning-step4-mental.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'test-results/captures/tour-08-morning-step5-intention.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: /Enregistrer mon matin/i }).click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-09-checkin-after-morning-streak1.png',
      fullPage: true,
    });

    // ─── 5) Dashboard with active streak ────────────────────────────────
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-10-dashboard-streak-1.png',
      fullPage: true,
    });

    // ─── 6) Wizard soir — quick run-through ─────────────────────────────
    await page.goto('/checkin/evening');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-11-evening-step1-discipline.png',
      fullPage: true,
    });

    await page.locator('label').filter({ hasText: /^Oui$/i }).first().click();
    await page
      .locator('label')
      .filter({ hasText: /^N\/A$/i })
      .first()
      .click();
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Suivant/i }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'test-results/captures/tour-12-evening-step5-reflection.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: /Enregistrer ma soirée/i }).click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-13-checkin-after-evening-final.png',
      fullPage: true,
    });

    // ─── 7) Final dashboard — both slots filled ─────────────────────────
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/tour-14-dashboard-both-slots-done.png',
      fullPage: true,
    });
  });
});
