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

  test('Gate 1 — the iOS install banner shows on /dashboard and links to the /install steps', async ({
    page,
    request,
  }, testInfo) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // Budget the whole test for a COLD dev server, not the banner wait. Against
    // `next dev` (Turbopack), the first hit compiles `/login` + `/api/auth/*` +
    // `/dashboard` + `/install` on demand — playwright.config measured a cold
    // `/api/auth/*` route at ~47s, which alone exceeds the local 30s per-test
    // timeout before the banner's own 15s auto-wait even starts. This raises the
    // compile budget ONLY — every assertion below is unchanged.
    test.setTimeout(120_000);

    // J8 criterion 1 asks for a « screenshot 375px », and the repo convention is
    // « Mobile-first strict. Tester en priorité absolue iPhone SE (375x667) ».
    // The `mobile-iphone-15` project boots at 393x852, so narrow the viewport to
    // the iPhone SE width the milestone actually names. Only the viewport moves:
    // the iOS-Safari UA that `<IOSInstallHint>` keys off is untouched, so the
    // WebKit-only precondition of this describe still holds.
    await page.setViewportSize({ width: 375, height: 667 });

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

    // playwright.config sets `screenshot: 'only-on-failure'`, so a PASSING run
    // captures nothing by itself. Attach the 375px proof explicitly — that
    // artefact IS the J8 « screenshot 375px » deliverable, not a debug aid.
    await testInfo.attach('j8-gate1-install-hint-375px', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // Second half of criterion 1: « bandeau install visible + page étapes ».
    // Follow the banner's own link rather than a hardcoded goto, so the test
    // fails if the CTA ever stops leading to the steps page.
    await installLink.click();
    await page.waitForURL('**/install', { timeout: 60_000 });

    // `/install` renders `<InstallGuide>` (src/components/pwa/install-guide.tsx),
    // whose landmark + <h1> live in the header that mounts BEFORE the
    // `isClient` branch — so both are asserted without racing hydration.
    const guide = page.getByRole('region', { name: "Installer l'application Fxmily" });
    await expect(guide).toBeVisible({ timeout: 30_000 });
    await expect(guide.getByRole('heading', { level: 1, name: /Installe Fxmily/ })).toBeVisible();
    // The page's own back-link — proves we landed on `/install` itself and not
    // on a redirect (the route is member-gated: inactive sessions go to /login).
    await expect(page.getByRole('link', { name: 'Tableau de bord' })).toBeVisible();

    await testInfo.attach('j8-gate1-install-steps-375px', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
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

/**
 * J8 criterion 3 — « /offline s'affiche avec assets stylés (pas de page nue) » —
 * and J8 scope 3 — « pre-cache des assets critiques du shell (pas seulement le
 * HTML) ».
 *
 * Gate 3 above navigates to `/offline` WHILE ONLINE, so the document keeps its
 * stylesheets in memory: it can never catch a naked page. Only a COLD start —
 * a brand-new navigation with the network already down — exercises what the
 * install handler actually stored. That is what these two gates do.
 *
 * Scoped to `chromium` (the Desktop Chrome project) rather than WebKit:
 *   - Playwright's WebKit has partial service-worker + Cache Storage support,
 *     so introspecting `caches` from the page is unreliable there.
 *   - `e2e.yml` runs the chromium project, so unlike the WebKit-only block
 *     above these assertions also execute in the main CI shards.
 * The behaviour under test is the service worker's, not the browser chrome's,
 * so proving it once on Chromium is a real proof — not a convenience.
 *
 * Same canon as above: NO `server-only` import, NO `waitForLoadState('networkidle')`.
 */
test.describe('J8 — cold offline start is styled, not a naked page', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Cache Storage introspection + SW cold start (chromium project)',
  );

  test('Gate 4 — install pre-caches /offline AND every stylesheet that document links', async ({
    page,
    request,
  }) => {
    // Cold `next dev` compiles `/offline` + emits its CSS chunks on first hit.
    test.setTimeout(120_000);

    // Warm the route once so the service worker's `cache.add` hits a compiled
    // page rather than racing Turbopack's first compile.
    await page.goto('/offline');

    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });
      // `ready` resolves once an ACTIVE worker controls this scope. The install
      // handler wraps its pre-cache in `event.waitUntil(...)`, so by the time
      // this resolves the shell bucket is fully populated — no polling needed.
      await navigator.serviceWorker.ready;
      return registration.scope;
    });
    expect(scope).toContain('/');

    // What the SERVED document declares. This mirrors the exact regex the
    // install handler runs against the cached HTML, so the test asserts the
    // handler's own contract instead of a DOM approximation (a stylesheet
    // injected by client JS would never be in the HTML the SW parsed).
    const html = await (await request.get('/offline')).text();
    const declaredCss = [
      ...new Set(
        [...html.matchAll(/href="(\/_next\/static\/[^"]*?\.css(?:\?[^"]*)?)"/g)].map((m) =>
          m[1]!.replaceAll('&amp;', '&'),
        ),
      ),
    ];

    // What the install handler actually stored.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find((n) => n.startsWith('fxmily-shell-')) ?? null;
      if (!shell) return { shell, urls: [] as string[] };
      const cache = await caches.open(shell);
      const requests = await cache.keys();
      return {
        shell,
        urls: requests.map((r) => {
          const u = new URL(r.url);
          return u.pathname + u.search;
        }),
      };
    });

    expect(cached.shell, 'the install handler must open a `fxmily-shell-*` bucket').not.toBeNull();
    expect(cached.urls, 'the offline document itself must be pre-cached').toContain('/offline');

    // If `/offline` linked no stylesheet at all it would be naked BY
    // CONSTRUCTION — so an empty list is a genuine failure of criterion 3, not
    // a reason to skip. Assert it rather than silently passing on zero.
    expect(
      declaredCss.length,
      'the /offline document must link at least one /_next/static stylesheet',
    ).toBeGreaterThan(0);

    for (const href of declaredCss) {
      expect(
        cached.urls,
        `stylesheet ${href} is linked by /offline but was NOT pre-cached — a cold offline start would paint it naked`,
      ).toContain(href);
    }
  });

  test('Gate 5 — a cold offline navigation renders /offline with its stylesheets live', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    await page.goto('/offline');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });

    // ── Isolate the invariant actually under test ────────────────────────────
    //
    // MEASURED, not theorised: with the two lines below removed, this gate PASSES
    // against the pre-fix service worker (`fxmily-sw-v4-j8`, which pre-caches the
    // offline HTML and NOTHING else) — so it proved nothing. The online `goto`
    // above had already populated two other stores that both mask the shell
    // bucket, because `cacheFirstAsset` answers from `caches.match(request)`,
    // which searches EVERY bucket:
    //   · `fxmily-runtime-*` — filled on demand by the cache-first strategy;
    //   · the browser's own HTTP cache — hit before the page even asks the SW.
    //
    // Clearing both reproduces the exact state the install-time pre-cache exists
    // for: a BRAND-NEW service-worker generation (a VERSION bump rotates every
    // bucket, so runtime starts empty) whose member has not re-fetched anything
    // online yet, and who then loses connectivity. In that state the shell bucket
    // is the only thing standing between them and a naked page.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('fxmily-runtime-')) await caches.delete(name);
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.clearBrowserCache');

    await context.setOffline(true);

    // THE cold start: a fresh navigation with the network already down, and with
    // every store EXCEPT the install-time shell bucket emptied. Nothing but that
    // bucket can paint this page.
    await page.goto('/offline');
    await expect(page.getByRole('heading', { name: 'Tu es hors ligne' })).toBeVisible();

    const painted = await page.evaluate(() => {
      const links = [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel="stylesheet"][href*="/_next/static/"]',
        ),
      ];
      const timing = new Map(
        performance
          .getEntriesByType('resource')
          .map((e) => e as PerformanceResourceTiming & { deliveryType?: string })
          .map((e) => [
            new URL(e.name).pathname,
            { deliveryType: e.deliveryType ?? '', decodedBodySize: e.decodedBodySize },
          ]),
      );

      return {
        // Did the app's own CSS actually take effect? `<body>` gets its colour
        // from `--bg`; with no stylesheet applied it stays UA-transparent.
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        sheets: links.map((link) => {
          const path = new URL(link.href).pathname;
          let rules = -1;
          try {
            // Throws `SecurityError` when the sheet did not load — Chromium
            // treats an errored same-origin sheet as cross-origin.
            rules = link.sheet ? link.sheet.cssRules.length : -1;
          } catch {
            rules = -1;
          }
          return { path, rules, ...(timing.get(path) ?? { deliveryType: '', decodedBodySize: 0 }) };
        }),
      };
    });

    expect(
      painted.sheets.length,
      'the cached document must still link its stylesheets',
    ).toBeGreaterThan(0);

    // ── Why this is NOT `live === linked` ────────────────────────────────────
    //
    // The obvious assertion — count `document.styleSheets` and compare — is
    // VACUOUS, and that was measured here, not reasoned about. Against the pre-fix
    // worker (`fxmily-sw-v4-j8`, which pre-caches no CSS at all), a genuinely naked
    // cold start still reported `live: 2 / linked: 2`: Chromium keeps a
    // CSSStyleSheet stub for a `<link>` whose fetch FAILED, so the count can never
    // drop and the assertion can never fail. Everything else about that same run
    // said "naked": `cssRules` threw, `decodedBodySize: 0`, `deliveryType: ""`,
    // `background-color: rgba(0, 0, 0, 0)`, `h1` at the 32px UA default.
    //
    // So we assert the three things that DID separate the two workers:
    //   · `deliveryType === 'cache-storage'` — the bytes came from Cache Storage,
    //     not from the HTTP/memory cache (v4 measured `""`);
    //   · `decodedBodySize > 0`             — bytes were really delivered (v4: 0);
    //   · `cssRules.length > 0`             — the sheet parsed and is readable
    //                                         (v4: threw).
    // Verified in BOTH modes: `next dev` and a production `next build` +
    // standalone server. Red on v4, green on v5, in each.
    for (const sheet of painted.sheets) {
      expect(
        sheet.deliveryType,
        `${sheet.path} was not served from Cache Storage (deliveryType="${sheet.deliveryType}") — the install-time shell bucket did not cover it`,
      ).toBe('cache-storage');
      expect(
        sheet.decodedBodySize,
        `${sheet.path} delivered 0 byte — the page painted naked`,
      ).toBeGreaterThan(0);
      expect(
        sheet.rules,
        `${sheet.path} exposes no readable CSS rule — its fetch failed, so the page painted naked`,
      ).toBeGreaterThan(0);
    }

    // Independent paint proof: a computed style only the app's CSS can produce.
    // `rgba(0, 0, 0, 0)` is exactly what the naked v4 run reported.
    expect(
      painted.bodyBackground,
      'the body kept the transparent UA default — no app stylesheet applied',
    ).not.toBe('rgba(0, 0, 0, 0)');

    await context.setOffline(false);
  });
});
