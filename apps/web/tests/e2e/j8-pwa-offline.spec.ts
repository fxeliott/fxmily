/**
 * J8 « Guide + PWA/offline iOS » — dedicated e2e for the 2 visual flows the J8
 * review flagged as proven only obliquely (unit `pwa/platform.test.ts` + the
 * component + the golden-path Playwright run, but never a targeted assertion).
 *
 * Scoped to the `mobile-iphone-15` Playwright project (WebKit, iOS Safari UA) —
 * the only context where `<IOSInstallHint>` renders (it requires an iOS-Safari
 * UA + non-standalone). `browserName === 'webkit'` uniquely selects that project
 * (the config's only other project, `chromium`, uses a Desktop Chrome UA).
 *
 *   Gate 1 — install banner : on `/dashboard` (the route hosting
 *     `<IOSInstallHint>`), the `role="region"` / aria-label « Installer Fxmily
 *     sur iPhone » appears and its "Voir" link points at `/install`.
 *   Gate 3 — `/offline` honesty + auto-reload : the styled « Tu es hors ligne »
 *     page survives going offline, and the inline `online → location.reload()`
 *     script (baked into the pre-cached shell) reloads it the instant
 *     connectivity returns.
 *
 * Canon (scars) :
 *   - NO `server-only` import — it crashes the Playwright runtime ("This module
 *     cannot be imported from a Client Component module"). Touch Postgres only
 *     through the `@/lib/db`-backed test helpers (which carry NO `server-only`).
 *   - NO `waitForLoadState('networkidle')` against the dev server — Turbopack
 *     keeps an HMR socket open so it never settles (deterministic local flake).
 *     `goto` (load) + `toBeVisible` auto-wait is enough.
 */

import { expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MEMBER_EMAIL = 'j8-pwa.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'J8-PwaOffline-2026!';

let member: SeededUser | null = null;

test.describe('J8 — PWA install hint + /offline honesty', () => {
  // `<IOSInstallHint>` only mounts under an iOS-Safari UA, and the
  // `context.setOffline` → auto-reload flow is asserted in the same WebKit
  // context. `webkit` === the `mobile-iphone-15` project (iPhone 15 device);
  // the `chromium` project (Desktop Chrome UA) can never satisfy Gate 1.
  test.skip(
    ({ browserName }) => browserName !== 'webkit',
    'iOS WebKit-only flows (mobile-iphone-15 project)',
  );

  test.beforeAll(async () => {
    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'J8',
      lastName: 'Pwa',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('Gate 1 — the iOS install banner shows on /dashboard and links to /install', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // Budget the whole test for a COLD dev server, not the banner wait. Against
    // `next dev` (Turbopack), the first hit compiles `/login` + `/api/auth/*` +
    // `/dashboard` on demand — playwright.config measured a cold `/api/auth/*`
    // route at ~47s, which alone exceeds the local 30s per-test timeout before
    // the banner's own 15s auto-wait even starts. This raises the compile budget
    // ONLY — every assertion below (toBeVisible 15s, href /install) is unchanged.
    test.setTimeout(90_000);

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');

    // `<IOSInstallHint>` hydrates from a "dismissed" server snapshot, then
    // re-reads the real platform + localStorage on the client. Under the iPhone
    // 15 WebKit UA (iOS Safari, non-standalone, fresh storage) the banner mounts
    // after hydration — auto-wait absorbs the dashboard's heavy hydration.
    const banner = page.getByRole('region', { name: 'Installer Fxmily sur iPhone' });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const installLink = banner.getByRole('link', { name: 'Voir' });
    await expect(installLink).toHaveAttribute('href', '/install');
  });

  test('Gate 3 — /offline is the honest styled page and auto-reloads on reconnect', async ({
    page,
    context,
  }) => {
    // `/offline` is public + `force-static` — navigate while online.
    await page.goto('/offline');
    const heading = page.getByRole('heading', { name: 'Tu es hors ligne' });
    await expect(heading).toBeVisible();

    // Cut the network : the already-loaded static shell stays honest (no crash,
    // no blank) because it renders with zero network.
    await context.setOffline(true);
    await expect(heading).toBeVisible();

    // Arm a sentinel on THIS document so we can prove the reload replaced it.
    await page.evaluate(() => {
      (window as unknown as { __fxmilyOfflineSentinel?: string }).__fxmilyOfflineSentinel = 'armed';
    });

    // Restore connectivity → the inline `online → location.reload()` fires.
    // Start listening for the reload's `load` event BEFORE flipping back online
    // so the reload can never race ahead of the listener.
    const reloaded = page.waitForEvent('load', { timeout: 15_000 });
    await context.setOffline(false);
    await reloaded;

    // The reload swapped in a fresh document → the sentinel is gone, and the
    // honest styled page rendered again.
    const sentinelAfter = await page.evaluate(
      () =>
        (window as unknown as { __fxmilyOfflineSentinel?: string }).__fxmilyOfflineSentinel ??
        'gone',
    );
    expect(sentinelAfter).toBe('gone');
    await expect(heading).toBeVisible();
  });
});
