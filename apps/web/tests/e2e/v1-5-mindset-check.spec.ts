/**
 * V1.5 MindsetCheck E2E — auth-gates + happy-path (capture/persist/render) +
 * cron public surface.
 *
 * SPEC §27. Covers the "Done quand" criterion in phases :
 *
 *   1. CAPTURE — a `MindsetCheck` created directly via Prisma is accepted by
 *      the V1.5 DB schema (Prisma 7 typing guarantees the contract at compile
 *      time; this re-verifies at runtime + the responses↔instrument shape).
 *   2. PERSIST — DB round-trip. The `@db.Date` `week_start` is anchored to the
 *      member's Europe/Paris civil Monday — `localDateOf`/`parseLocalDate`
 *      exactly like `v1-3-training-debrief.spec.ts` (else deterministic
 *      nocturnal flake 22:00–00:00 UTC, invariant §27.7 / PR#96).
 *   3. RENDER — `/mindset`, `/mindset/new` (member) and
 *      `/admin/members/[id]?tab=mindset` (admin) load without bouncing to
 *      `/login` and show the seeded data, no Next error-overlay.
 *   4. CRON — `/api/cron/mindset-check-reminders` public surface: POST without
 *      a secret is refused (503 unconfigured / 401), GET is 405.
 *
 * NOT covered (canon `v1-3-training-debrief.spec.ts:18-22`) : driving the
 * Likert wizard UI (hidden inputs + localStorage → fragile selectors). The
 * capture layer is covered by the Vitest Zod / Server-Action / aggregator
 * unit tests.
 *
 * Cleanup : `MindsetCheck` declares `onDelete: Cascade` AND `cleanupTestUsers`
 * wipes it explicitly (`db-helpers.ts`, FK-correct before `db.user`).
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { CURRENT_MINDSET_INSTRUMENT } from '@/lib/mindset/instrument';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';

const MEMBER_EMAIL = 'v1-5-mindset.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'V1_5-MindsetPwd-2026!';
const ADMIN_EMAIL = 'v1-5-mindset.admin.e2e.test@fxmily.local';
const ADMIN_PASSWORD = 'V1_5-MindsetAdminPwd-2026!';

// Every item answered 4 → each dimension mean 4 → (4-1)/4*100 = 75 → overall
// 75. A stable, encoding-free assertable surface for the dashboard + timeline.
const ALL_FOUR = 4;
const EXPECTED_OVERALL = '75/100';

let member: SeededUser | null = null;
let admin: SeededUser | null = null;

/** Monday (UTC) of the Europe/Paris civil week containing `now`, YYYY-MM-DD. */
function currentParisWeekMonday(): string {
  const todayParis = localDateOf(new Date(), PARIS_TZ);
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
}

function fullResponses(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const item of CURRENT_MINDSET_INSTRUMENT.items) r[item.id] = ALL_FOUR;
  return r;
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

test.describe('V1.5 MindsetCheck — auth-gates + happy-path persist/render + cron', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'V1_5',
      lastName: 'Mindset',
    });
    admin = await seedAdminUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstName: 'V1_5',
      lastName: 'MindsetAdmin',
    });

    // Seed the member's current-week MindsetCheck UP-FRONT so the RENDER
    // tests below are self-contained + deterministic. Previously they relied
    // on the "CAPTURE + PERSIST" test having created the row first — a fragile
    // inter-test data dependency that intermittently rendered as the empty
    // state under CI load (the seeded row exists in the DB, proven, but the
    // ordering made the render tests flaky/red). All four items answered 4 →
    // every dimension mean 4 → overall 75 → the assertable `EXPECTED_OVERALL`.
    await db.mindsetCheck.create({
      data: {
        userId: member.id,
        weekStart: parseLocalDate(currentParisWeekMonday()),
        instrumentVersion: CURRENT_MINDSET_INSTRUMENT.version,
        responses: fullResponses(),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    admin = null;
  });

  test('anon is bounced to /login on /mindset and /mindset/new', async ({ page }) => {
    await page.goto('/mindset');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/mindset/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('CAPTURE + PERSIST: a MindsetCheck round-trips through Prisma', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const mondayStr = currentParisWeekMonday();
    const weekStartDate = parseLocalDate(mondayStr);
    // The app only ever writes a Monday-UTC weekStart (Zod
    // `mindsetWeekStartSchema`) — assert the fixture math is faithful.
    expect(weekStartDate.getUTCDay()).toBe(1);

    // Idempotent upsert: `beforeAll` already seeded this week's row, so a bare
    // `create` would hit the `(userId, weekStart)` unique constraint. The
    // round-trip contract (Monday weekStart, frozen version, responses shape)
    // is still fully exercised on the persisted row.
    const check = await db.mindsetCheck.upsert({
      where: { userId_weekStart: { userId: member.id, weekStart: weekStartDate } },
      create: {
        userId: member.id,
        weekStart: weekStartDate,
        instrumentVersion: CURRENT_MINDSET_INSTRUMENT.version,
        responses: fullResponses(),
      },
      update: {
        instrumentVersion: CURRENT_MINDSET_INSTRUMENT.version,
        responses: fullResponses(),
      },
      select: {
        id: true,
        weekStart: true,
        instrumentVersion: true,
        responses: true,
      },
    });

    // @db.Date round-trips as UTC-midnight Date — serialized like the service.
    expect(check.weekStart.toISOString().slice(0, 10)).toBe(mondayStr);
    expect(check.instrumentVersion).toBe(CURRENT_MINDSET_INSTRUMENT.version);
    const responses = check.responses as Record<string, number>;
    expect(Object.keys(responses)).toHaveLength(CURRENT_MINDSET_INSTRUMENT.items.length);
    for (const item of CURRENT_MINDSET_INSTRUMENT.items) {
      expect(responses[item.id]).toBe(ALL_FOUR);
    }
  });

  test('RENDER: /mindset shows the premium dashboard + timeline for the seeded check', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/mindset');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/mindset/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/mindset/i);
    await expect(page.locator('[data-slot="mindset-timeline"]')).toBeVisible();
    // A complete check exists → the real dashboard renders, not the empty one.
    await expect(page.locator('[data-slot="mindset-dashboard"]')).toBeVisible();
    await expect(page.locator('[data-slot="mindset-dashboard-empty"]')).toHaveCount(0);
    await expect(page.getByText(EXPECTED_OVERALL).first()).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /mindset/new shows the Likert wizard', async ({ page, request }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/mindset/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/mindset\/new/);
    await expect(page.locator('[data-slot="mindset-wizard"]')).toBeVisible();
    await expect(page.locator('[data-slot="mindset-step-progress"]')).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: admin sees the read-only mindset section in ?tab=mindset', async ({
    page,
    request,
  }) => {
    if (!member || !admin) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/admin/members/${member.id}?tab=mindset`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(new RegExp(`/admin/members/${member.id}`));
    await expect(page.locator('[data-slot="member-mindset-checks"]')).toBeVisible();
    await expect(page.getByText(EXPECTED_OVERALL).first()).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('CRON public surface: POST without secret is refused, GET is 405', async ({ request }) => {
    const post = await request.post('/api/cron/mindset-check-reminders');
    // 503 when CRON_SECRET is unconfigured (test env), 401 when set+missing.
    expect([401, 503]).toContain(post.status());

    const get = await request.get('/api/cron/mindset-check-reminders');
    expect(get.status()).toBe(405);
  });
});
