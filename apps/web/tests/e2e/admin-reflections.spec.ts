/**
 * J6-admin-scale item 4 — RUNTIME proof for the admin "Vue des réflexions"
 * (pass/fail criterion #3).
 *
 * The `ReflectionEntry` is a private CBT (Ellis ABCD) daily journal. J6 item 4
 * gives the sole admin a READ-ONLY window onto it, in two shapes:
 *   1. a cross-member chronological feed at `/admin/reflections`;
 *   2. a per-member tab at `/admin/members/[id]?tab=reflections`.
 *
 * This spec is the browser gate that proves criterion #3 end-to-end against a
 * real Next page + real admin session + real Prisma data:
 *
 *   (a) POSITIVE — the admin SEES a seeded member's reflection on BOTH the
 *       cross-member feed (with the member's display name + ABCD text verbatim)
 *       AND the per-member `?tab=reflections` panel, with zero console/page
 *       error and no Next error overlay.
 *
 *   (b) NEGATIVE — a logged-in NON-admin member (and an anonymous visitor) is
 *       REFUSED. The refusal is an HTTP **307** redirect to `/login`, NOT a 403.
 *
 *       Why 307 and not 403 — the nuance this spec pins on purpose:
 *         · `/admin/*` is gated at TWO layers. The edge `proxy.ts`
 *           (`authConfig.authorized`) returns `auth.user.role === 'admin'`, so a
 *           member (role='member') returns `false` → Auth.js short-circuits with
 *           a redirect to `pages.signIn` = `/login`. That is a **307 Temporary
 *           Redirect**, fired BEFORE the page ever renders.
 *         · Even if a request slipped past the proxy, the page itself calls
 *           `redirect('/login')` (Server Component), which Next serialises as a
 *           NEXT_REDIRECT → also a **307**, GET-preserving.
 *       Either way the member/anon gets `307 → /login`, never `403 Forbidden`.
 *       The negative assertions therefore check `status() === 307` + a Location
 *       header pointing at `/login`, and would (correctly) FAIL on a 403.
 *
 * Seeding is direct Prisma (`db.reflectionEntry.create`) — this spec NEVER
 * imports the `'server-only'` admin service (`lib/admin/reflections-service.ts`,
 * `import 'server-only'` on line 1), which would crash the Playwright runtime.
 * Only `@/lib/db` (no server-only marker) + `@/test/*` helpers are imported.
 *
 * No `waitForLoadState('networkidle')` — Turbopack keeps an HMR socket open
 * under `next dev`, so it never settles; `goto` (load) + auto-waiting locators
 * are deterministic on dev AND prod.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const GOTO_TIMEOUT = 120_000;

// DEV-ONLY console/pageerror noise under `next dev` (no Caddy, HMR, dev overlay
// probes). Targeted so a REAL app error is still caught.
const BENIGN = [
  /ResizeObserver loop/i,
  /Hydration failed/i,
  /hmr-client/i,
  /__nextjs_original-stack-frames/i,
  /browser_dev_/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
];

const isBenign = (msg: string) => BENIGN.some((re) => re.test(msg));

// Distinctive markers so the assertions never collide with other rows that may
// already live in the target DB. ABCD fields must be >= 10 chars (schema).
const R1_TRIGGER = 'E2E réflexion un — déclencheur alpha marqueur';
const R1_BELIEF = 'E2E croyance automatique alpha marqueur';
const R1_CONSEQUENCE = 'E2E conséquence alpha marqueur';
const R1_DISPUTATION = 'E2E mise en question alpha marqueur';

const R2_TRIGGER = 'E2E réflexion deux — déclencheur bravo marqueur';
const R2_BELIEF = 'E2E croyance automatique bravo marqueur';
const R2_CONSEQUENCE = 'E2E conséquence bravo marqueur';
const R2_DISPUTATION = 'E2E mise en question bravo marqueur';

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

/** Collect console errors + uncaught page errors while `fn` runs. */
async function withErrorCapture(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error' && !isBenign(m.text())) errors.push(`console: ${m.text()}`);
  };
  const onPageError = (e: Error) => {
    const msg = e.message ?? String(e);
    if (!isBenign(msg)) errors.push(`pageerror: ${msg}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await fn();
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  return errors;
}

test.describe('J6 item 4 — admin reflections view (real DB + admin session)', () => {
  let admin: SeededUser | null = null;
  let member: SeededUser | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'ReflAdmin' });
    member = await seedMemberUser({ firstName: 'Reflectrix' });

    // Two reflections, oldest first. Explicit `createdAt` so the cross-member
    // feed order (newest first) is deterministic — the service unit tests own
    // the ordering contract, here we only need both rows present + renderable.
    await db.reflectionEntry.create({
      data: {
        userId: member.id,
        date: new Date('2026-07-14T00:00:00.000Z'),
        triggerEvent: R1_TRIGGER,
        beliefAuto: R1_BELIEF,
        consequence: R1_CONSEQUENCE,
        disputation: R1_DISPUTATION,
        createdAt: new Date('2026-07-14T08:00:00.000Z'),
      },
    });
    await db.reflectionEntry.create({
      data: {
        userId: member.id,
        date: new Date('2026-07-15T00:00:00.000Z'),
        triggerEvent: R2_TRIGGER,
        beliefAuto: R2_BELIEF,
        consequence: R2_CONSEQUENCE,
        disputation: R2_DISPUTATION,
        createdAt: new Date('2026-07-15T09:30:00.000Z'),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
  });

  test('admin sees a member reflection on the cross-member feed AND the per-member tab', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');

    // `loginAs` runs the CSRF + credentials dance on the `request` context and
    // copies the session cookie onto the page context — no page navigation.
    await loginAs(page, request, admin.email, admin.password);

    const errors = await withErrorCapture(page, async () => {
      // 1) Cross-member chronological feed.
      await page.goto('/admin/reflections', {
        waitUntil: 'domcontentloaded',
        timeout: GOTO_TIMEOUT,
      });
      await expect(page).not.toHaveURL(/\/login(\?|$)/);
      await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

      // The feed exists and carries the seeded member's identity + ABCD text.
      await expect(page.locator('[data-slot="admin-reflections-list"]')).toBeVisible();
      await expect(
        page.getByText(`${member!.firstName} ${member!.lastName}`, { exact: false }).first(),
      ).toBeVisible();
      await expect(page.getByText(R2_TRIGGER, { exact: false })).toBeVisible();
      await expect(page.getByText(R2_DISPUTATION, { exact: false })).toBeVisible();
      // Both entries render (older one too).
      await expect(page.getByText(R1_TRIGGER, { exact: false })).toBeVisible();

      // 2) Per-member panel via the `?tab=reflections` tab.
      await page.goto(`/admin/members/${member!.id}?tab=reflections`, {
        waitUntil: 'domcontentloaded',
        timeout: GOTO_TIMEOUT,
      });
      await expect(page).not.toHaveURL(/\/login(\?|$)/);
      await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

      await expect(page.getByText('Réflexions ABCD', { exact: false })).toBeVisible();
      await expect(page.locator('[data-slot="member-reflections-list"]')).toBeVisible();
      await expect(page.getByText(R2_TRIGGER, { exact: false })).toBeVisible();
      await expect(page.getByText(R1_TRIGGER, { exact: false })).toBeVisible();
    });

    expect(errors, `runtime errors on admin reflections views:\n${errors.join('\n')}`).toEqual([]);
  });

  test('non-admin (member + anon) is refused with 307 → /login (NOT 403)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // --- Anonymous (no session): must be refused BEFORE we authenticate the
    // shared `request` context via loginAs. The edge proxy redirects (307).
    const anonFeed = await request.get('/admin/reflections', { maxRedirects: 0 });
    expect(
      anonFeed.status(),
      `anon: expected 307 redirect, got ${anonFeed.status()} (a 403 would be wrong here)`,
    ).toBe(307);
    expect(anonFeed.headers()['location'] ?? '').toContain('/login');

    // --- Authenticated NON-admin member: proxy `authorized()` returns
    // `role === 'admin'` = false → 307 redirect to /login. `page.request`
    // inherits the member session cookie copied onto the page context.
    await loginAs(page, request, member.email, member.password);

    const memberFeed = await page.request.get('/admin/reflections', { maxRedirects: 0 });
    expect(
      memberFeed.status(),
      `member: expected 307 redirect, got ${memberFeed.status()} (a 403 would be wrong here)`,
    ).toBe(307);
    expect(memberFeed.headers()['location'] ?? '').toContain('/login');

    // The per-member reflections tab is gated the same way.
    const memberTab = await page.request.get(`/admin/members/${member.id}?tab=reflections`, {
      maxRedirects: 0,
    });
    expect(memberTab.status(), `member tab: expected 307, got ${memberTab.status()}`).toBe(307);
    expect(memberTab.headers()['location'] ?? '').toContain('/login');
  });
});
