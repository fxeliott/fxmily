/**
 * J6 scope 5 — RUNTIME proof of the admin séance replay "Vu par X/N" coverage
 * badge, exercised end-to-end against the real Postgres through the real UI.
 *
 *   A. POSITIVE — after ONE member has opened a held (published) séance
 *      (seeded as a real `ReplayView` row via `@/lib/db`), the admin
 *      `/admin/seances` cell for that séance shows the coverage badge with a
 *      distinct-viewer count of exactly 1 (`data-viewer-count="1"`, text
 *      "Vu par 1/N"), with zero console/page error. This drives the REAL
 *      `countViewersForSessions` + `activeMemberCount` server-side aggregation.
 *
 *   B. NEGATIVE (security trap) — an authenticated NON-admin member is refused
 *      `/admin/seances`. The page is admin-gated at the edge (`auth.config.ts`
 *      `authorized()` returns `role === 'admin'`), so a member is redirected
 *      (307 → /login → then, being authenticated, on to /dashboard) and NEVER
 *      sees the go/no-go heading. Mirrors `seances-admin-runtime.spec.ts` test B
 *      — the correct assertion for THIS page is the /dashboard landing, not 403.
 *
 * No new admin route/handler is introduced by scope 5: the badge is rendered
 * inside the already-gated `/admin/seances` Server Component and its data comes
 * from the existing `listSeancesForAdmin` loader. This spec is therefore the
 * counter-proof mandated by the task (a member view → "1/N" in the admin
 * column), with the member-refusal assertion kept for defense in depth.
 *
 * Determinism (canon J-C3): no `networkidle`; every assertion is gated on an
 * auto-waiting `expect(locator)`. The seeded `ReplaySession` has 0 FK to User,
 * so it is seeded + cleaned by its `(date, slot)` key independently of
 * `cleanupTestUsers`; its `ReplayView` cascades on the session delete. The cell
 * is keyed on TODAY (Europe/Paris), `analyse` slot (distinct from the `debrief`
 * slot the go/no-go spec uses), so both land inside the rolling admin window
 * without colliding. `@/lib/db` (no `server-only` marker) is the only app module
 * imported — never the `server-only` admin/replay services.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let admin: SeededUser | null = null;
let member: SeededUser | null = null;
let sessionId: string | null = null;

const TEST_SLOT = 'analyse' as const;

/** Today's civil day (Europe/Paris) as YYYY-MM-DD — the seeded cell's key. */
function todayParis(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Delete the seeded (date, slot) séance — its ReplayView rows cascade. */
async function cleanupTestCell(): Promise<void> {
  await db.replaySession.deleteMany({
    where: { date: parseLocalDate(todayParis()), slot: TEST_SLOT },
  });
}

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

function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const ALLOW = [/React DevTools/i, /favicon/i, /Download the React/i];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ALLOW.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return () => errors;
}

test.describe('Séances admin — "Vu par X/N" replay coverage (runtime)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    await cleanupTestCell();
    admin = await seedAdminUser({ firstName: 'ViewsAdmin' });
    member = await seedMemberUser({ firstName: 'ViewsMember' });

    // A held (published) séance today → its admin cell shows the coverage badge.
    const seance = await db.replaySession.create({
      data: {
        date: parseLocalDate(todayParis()),
        slot: TEST_SLOT,
        status: 'done',
        title: 'Analyse de test (vu par)',
        time: '12h00',
      },
      select: { id: true },
    });
    sessionId = seance.id;

    // ONE member opened the replay → exactly one distinct viewer for this session.
    await db.replayView.create({ data: { sessionId: seance.id, userId: member.id } });
  });

  test.afterAll(async () => {
    await cleanupTestCell();
    await cleanupTestUsers();
    admin = null;
    member = null;
    sessionId = null;
  });

  test('A — an admin sees "Vu par 1/N" on the seeded held séance', async ({ page, request }) => {
    test.setTimeout(180_000);
    if (!admin || !sessionId) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);
    const today = todayParis();

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto('/admin/seances');
    await expect(page.getByRole('heading', { name: 'Go / No-Go des séances' })).toBeVisible({
      timeout: 30_000,
    });

    const cell = page.locator(`[data-seance-cell="${today}#${TEST_SLOT}"]`);
    await expect(cell).toBeVisible();

    // The coverage badge: exactly 1 distinct viewer over the active-member N.
    const badge = cell.locator('[data-slot="seance-viewers"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-viewer-count', '1');
    // Text is "Vu par 1/N" with N a positive integer (cohort-dependent).
    await expect(badge).toHaveText(/^Vu par 1\/\d+$/);

    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('B — a member is refused /admin/seances (never sees the go/no-go surface)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/admin/seances');
    // Admin-gated (proxy role check): an AUTHENTICATED non-admin is bounced to
    // /dashboard (307 → /login → /dashboard), never shown the admin surface.
    await expect(page.getByRole('heading', { name: 'Go / No-Go des séances' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);
    // And the coverage badge never renders for a non-admin.
    await expect(page.locator('[data-slot="seance-viewers"]')).toHaveCount(0);
  });
});
