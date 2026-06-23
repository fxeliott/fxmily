/**
 * Session 21 — runtime verification of the two server-rendered surfaces this
 * session touched, exercised against a REAL Postgres + a REAL Auth.js session
 * (not just unit/RTL):
 *
 *   1. `/account/data` — the RGPD portability preview, now mirroring the FULL
 *      export (behavioural / psychological surface). Proves the ~19 extra
 *      live `count()` queries (userId + memberId keyed) all run without a
 *      server crash and the page renders the new sections.
 *   2. `/pre-trade/new` — the empirical mirror elevation. Proves the server
 *      page's `loadPreTradeCorrelationData` call + the server→client prop
 *      hand-off render end-to-end, and that picking a reason surfaces the
 *      mirror. A freshly-seeded member has no linked trades, so the mirror is
 *      in its honest "pending" state (no fabricated rate) — which is exactly
 *      the server→client path we need to prove at runtime (the `fact` and
 *      `pending` *formatting* is already pinned by the component RTL tests).
 *
 * Both pages are auth-gated `status === 'active'`; we log in via the real
 * credentials flow (`loginAs`) so the data-fetch path actually executes.
 */

import { expect, test } from '@playwright/test';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

test.describe('Session 21 — RGPD export preview + pre-trade mirror (runtime)', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    seeded = await seedMemberUser({ firstName: 'Mira' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('/account/data renders the full portability preview with zero console errors', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto('/account/data');
    await expect(page).toHaveURL(/\/account\/data/);
    await expect(page.getByRole('heading', { name: 'Mes données', level: 1 })).toBeVisible();

    // Scope to the export preview region — the bottom-nav quick-log surface
    // also has a "Habitudes" link, so a page-wide getByText is ambiguous.
    const exportRegion = page.getByRole('region', { name: /Ce que contient/ });

    // The Session 21 additions to the preview must render (they exercise the
    // new memberId-keyed and userId-keyed count queries).
    await expect(exportRegion.getByText('Habitudes', { exact: true })).toBeVisible();
    await expect(exportRegion.getByText('Vérification & honnêteté', { exact: true })).toBeVisible();
    await expect(exportRegion.getByText('Profil d’accompagnement', { exact: true })).toBeVisible();
    // The download CTA is intact.
    await expect(page.getByRole('button', { name: /Télécharger l’export JSON/i })).toBeVisible();

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('/pre-trade/new surfaces the empirical mirror when a reason is picked', async ({
    page,
    request,
  }) => {
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto('/pre-trade/new');
    await expect(page).toHaveURL(/\/pre-trade\/new/);
    await expect(page.getByRole('heading', { name: /Pourquoi tu prends ce trade/ })).toBeVisible();

    // No mirror before a reason is chosen.
    await expect(page.locator('[data-slot="reason-mirror"]')).toHaveCount(0);

    // Pick a risk reason → the empirical mirror appears. A fresh member has no
    // linked trades, so it is the honest "pending" state (no invented number).
    await page.getByRole('radio', { name: /Peur de rater/ }).click();
    const mirror = page.locator('[data-slot="reason-mirror"]');
    await expect(mirror).toBeVisible();
    await expect(mirror).toContainText(/miroir|trade/i);
    // Posture §2 — never a directive.
    await expect(mirror).not.toContainText(/évite|arrête|ne prends pas/i);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
