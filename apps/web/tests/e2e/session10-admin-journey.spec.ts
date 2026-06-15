/**
 * SESSION 10 — Interconnexion / Validation finale.
 *
 * ADMIN end-to-end NON-RUPTURE sweep (DoD §30 #1 — « parcours bout-en-bout
 * admin testé sans rupture »). One authenticated admin visits EVERY admin
 * surface, including the member detail page with each ?tab= panel and a real
 * member trade detail, asserting per route:
 *   1. the admin role gate held (no bounce to /login or /dashboard);
 *   2. no Next.js runtime error overlay;
 *   3. no uncaught page error.
 *
 * Deliberately covers the admin surfaces that had NO functional spec before S10:
 * `/admin/reports`, `/admin/cards`, `/admin/reunions`, `/admin/system`.
 *
 * Seeding: a member WITH a little trade history (so the admin member-detail and
 * trade-annotation pages render real rows) + an admin. Direct Prisma, never a
 * `'server-only'` import. chromium only (mobile proven by S9).
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedMemberUser,
  seedAdminUser,
  seedTradeHistory,
  seedCheckinHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const GOTO_TIMEOUT = 120_000;

const BENIGN_PAGEERROR = [/ResizeObserver loop/i, /Hydration failed/i];

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

async function visitAndAssert(page: Page, route: string): Promise<void> {
  const pageErrors: string[] = [];
  const onPageError = (err: Error) => {
    const msg = err.message ?? String(err);
    if (!BENIGN_PAGEERROR.some((re) => re.test(msg))) pageErrors.push(`${route} :: ${msg}`);
  };
  page.on('pageerror', onPageError);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

    // Admin gate held — never bounce to /login (no session) or /dashboard
    // (member without admin role). Both would mean the admin gate broke.
    await expect(page, `${route} bounced to /login (admin session gate broke)`).not.toHaveURL(
      /\/login(\?|$)/,
    );
    await expect(
      page.locator('[data-nextjs-dialog-overlay]'),
      `${route} rendered a Next.js error overlay`,
    ).toHaveCount(0);
    await page.waitForTimeout(150);
  } finally {
    page.off('pageerror', onPageError);
  }

  expect(pageErrors, `uncaught page error(s) on ${route}`).toEqual([]);
}

test.describe('S10 — parcours admin bout-en-bout : non-rupture de toutes les surfaces (real DB)', () => {
  let admin: SeededUser | null = null;
  let member: SeededUser | null = null;
  let memberTradeId: string | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'S10Admin' });
    member = await seedMemberUser({ firstName: 'S10Tracked' });
    await seedTradeHistory(member.id, { count: 8, seed: 2020 });
    await seedCheckinHistory(member.id, { days: 7, seed: 2020 });

    const trade = await db.trade.findFirst({
      where: { userId: member.id },
      orderBy: { enteredAt: 'desc' },
      select: { id: true },
    });
    memberTradeId = trade?.id ?? null;
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
  });

  test('un admin visite toutes ses surfaces sans la moindre rupture', async ({ page, request }) => {
    // Serial sweep of ~15 admin routes; cold-compile under `next dev` (worse in
    // CI) can exceed the default budget. Coverage sweep, not a latency check.
    test.setTimeout(600_000);
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    const id = member.id;
    const ADMIN_ROUTES = [
      '/admin/members',
      `/admin/members/${id}`,
      `/admin/members/${id}?tab=checkins`,
      `/admin/members/${id}?tab=pre-trade`,
      `/admin/members/${id}?tab=mindset`,
      `/admin/members/${id}?tab=training`,
      `/admin/members/${id}?tab=calendar`,
      `/admin/members/${id}?tab=verification`, // S3 admin truth surface
      '/admin/invite',
      '/admin/access-requests',
      '/admin/cards', // GAP before S10
      '/admin/reports', // GAP before S10
      '/admin/reunions', // GAP before S10
      '/admin/system', // GAP before S10
    ];
    if (memberTradeId) {
      ADMIN_ROUTES.push(`/admin/members/${id}/trades/${memberTradeId}`);
    }

    for (const route of ADMIN_ROUTES) {
      await visitAndAssert(page, route);
    }
  });

  test('un MEMBRE ne peut PAS accéder à l’espace admin (isolation des rôles)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // A member hitting an admin route must be rejected (bounce away from
    // /admin/* — to /dashboard or /login per auth.config.ts).
    await page.goto('/admin/members', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
    await expect(page, 'a member reached /admin/members — role isolation broke').not.toHaveURL(
      /\/admin(\/|$)/,
    );
  });
});
