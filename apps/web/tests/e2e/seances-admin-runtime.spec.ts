/**
 * Réunion Trading Hub (séances) — RUNTIME proof of the J3 ADMIN go/no-go surface
 * (`/admin/seances`), exercised end-to-end against the real Postgres through the
 * real UI:
 *
 *   A. ADMIN go/no-go round-trip — an admin declares a `scheduled` séance as
 *      "Tenue"; the mutation persists to Postgres AND the no-rewind guard then
 *      locks the "Prévue" choice (a held session can never revert to scheduled).
 *
 *   B. ACCESS — a member is redirected away from `/admin/seances` (admin-gated).
 *
 * Determinism (canon J-C3): no `networkidle`; every assertion is gated on an
 * auto-waiting `expect(locator)`. The seeded `ReplaySession` has 0 FK to User,
 * so it is seeded + cleaned by its `(date, slot)` key independently of
 * `cleanupTestUsers`. The cell is keyed on TODAY (Europe/Paris) so it lands
 * inside the admin calendar's rolling window.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from '@playwright/test';

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

const TEST_SLOT = 'debrief' as const;

/** Today's civil day (Europe/Paris) as YYYY-MM-DD — the seeded cell's key. */
function todayParis(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function cleanupTestCell(): Promise<void> {
  await db.replaySession.deleteMany({
    where: { date: parseLocalDate(todayParis()), slot: TEST_SLOT },
  });
}

async function seedScheduledCell(): Promise<void> {
  await cleanupTestCell();
  await db.replaySession.create({
    data: {
      date: parseLocalDate(todayParis()),
      slot: TEST_SLOT,
      status: 'scheduled',
      title: 'Débrief de test (go/no-go)',
      time: '20h00',
    },
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

async function dismissCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
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

test.describe('Séances admin — go/no-go (runtime)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    await cleanupTestCell();
    admin = await seedAdminUser({ firstName: 'SeanceAdmin' });
    member = await seedMemberUser({ firstName: 'SeanceMember' });
  });

  test.beforeEach(async () => {
    await seedScheduledCell();
  });

  test.afterAll(async () => {
    await cleanupTestCell();
    await cleanupTestUsers();
    admin = null;
    member = null;
  });

  test('A — admin déclare « Tenue », la mutation persiste + no-rewind verrouille « Prévue »', async ({
    page,
    request,
  }) => {
    if (!admin) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);
    const today = todayParis();

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto('/admin/seances');
    await expect(page.getByRole('heading', { name: 'Go / No-Go des séances' })).toBeVisible();

    // Locate the seeded cell (today, debrief).
    const cell = page.locator(`[data-seance-cell="${today}#${TEST_SLOT}"]`);
    await expect(cell).toBeVisible();

    // Declare "Tenue" then save.
    await cell.getByText('Tenue', { exact: true }).click();
    await cell.getByRole('button', { name: 'Enregistrer' }).click();
    // Generous timeout: the first server-action invocation cold-compiles under
    // `next dev` (the route compile can exceed the default 5s assertion budget).
    await expect(cell.getByText('Enregistré.')).toBeVisible({ timeout: 30_000 });

    // RUNTIME INVARIANT — the mutation reached Postgres.
    const row = await db.replaySession.findUnique({
      where: { date_slot: { date: parseLocalDate(today), slot: TEST_SLOT } },
      select: { status: true },
    });
    expect(row?.status).toBe('done');

    // no-rewind — after a fresh render, a held session locks "Prévue".
    await page.reload();
    const cell2 = page.locator(`[data-seance-cell="${today}#${TEST_SLOT}"]`);
    await expect(cell2.locator('input[value="scheduled"]')).toBeDisabled();
    // The pipeline panel now shows for a held session.
    await expect(cell2.getByText('Pipeline')).toBeVisible();

    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('B — un membre est redirigé hors de /admin/seances', async ({ page, request }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/admin/seances');
    // Admin-gated (proxy.ts role check): an AUTHENTICATED non-admin is bounced to
    // /dashboard (never shown the go/no-go surface) — only an UNauthenticated
    // visitor would land on /login.
    await expect(page.getByRole('heading', { name: 'Go / No-Go des séances' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
