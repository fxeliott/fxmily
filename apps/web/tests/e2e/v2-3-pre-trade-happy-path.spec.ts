/**
 * V2.3 PreTradeCheck E2E — auth-gate + happy-path (capture/persist) + auto-link
 * + triggers UI render (Card /dashboard + Banner /journal/new).
 *
 * ADR-003 + SPEC §18.4. Covers V2.3 anti-FOMO wizard surface in 4 phases :
 *
 *   1. AUTH GATE — anon bounced to /login on /pre-trade/new (proxy.ts matcher
 *      + page-level `auth()` + `status='active'` gate).
 *   2. CAPTURE + PERSIST — a `PreTradeCheck` created directly via Prisma is
 *      accepted by the V2.3 DB schema (Prisma 7 typing guarantees the contract
 *      at compile time ; this re-verifies at runtime the 4-field shape +
 *      `linkedTradeId String?` nullable + 2 Postgres enums `PreTradeReason`
 *      and `PreTradeEmotion`).
 *   3. AUTO-LINK — `linkRecentCheckToTrade(userId, tradeId)` pairs the most
 *      recent unlinked check with a Trade created within `LINK_DEFAULT_WINDOW_MIN`
 *      (15 min). P2025-safe optimistic locking via `WHERE linkedTradeId IS NULL`
 *      predicate (cf. `lib/pre-trade/service.ts:144-172`).
 *   4. RENDER triggers UI — `/pre-trade/new` shows the wizard for an authed
 *      member ; `/dashboard` surfaces Trigger A Card with
 *      `aria-labelledby="pre-trade-heading"` ; `/journal/new` surfaces the
 *      live day status `data-slot="pre-trade-today-status"` (todo|done).
 *
 * NOT covered (canon `v1-5-mindset-check.spec.ts:18-22`) : driving the 4-step
 * wizard UI itself (hidden inputs + localStorage draft → fragile selectors).
 * The capture+persist + Server Action layer is covered by Vitest +22 tests
 * V2.3 (cf. `lib/pre-trade/service.test.ts` + `app/pre-trade/actions.test.ts`).
 *
 * Cleanup : `PreTradeCheck` declares `onDelete: Cascade` on User (FK in
 * migration `20260526100000_v2_3_pre_trade_check`). `cleanupTestUsers` wipes
 * the rows explicitly (carbone V1.5/V1.8/V1.3 pattern — FK-correct BEFORE
 * `db.user.deleteMany`).
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * Inline replica of `linkRecentCheckToTrade` from `lib/pre-trade/service.ts`
 * (which uses `import 'server-only'` and so cannot be loaded from the
 * Playwright runtime — `vitest.config.ts:13` aliases `server-only` to a
 * shim, but `playwright.config.ts` has no equivalent alias).
 *
 * Pattern carbone `v1-5-mindset-check.spec.ts`: tests talk to Prisma
 * directly via `@/lib/db` (which does NOT import `server-only`), no service
 * imports.
 *
 * Semantics MUST match the service exactly: 15-min window, optimistic
 * locking via `linkedTradeId IS NULL` predicate, P2025 → null (lost race).
 */
const LINK_DEFAULT_WINDOW_MIN = 15;

async function linkRecentCheckToTradeInline(
  userId: string,
  tradeId: string,
  windowMin: number = LINK_DEFAULT_WINDOW_MIN,
): Promise<string | null> {
  const since = new Date(Date.now() - windowMin * 60_000);

  const recent = await db.preTradeCheck.findFirst({
    where: { userId, linkedTradeId: null, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!recent) return null;

  try {
    await db.preTradeCheck.update({
      where: { id: recent.id, linkedTradeId: null },
      data: { linkedTradeId: tradeId },
    });
    return recent.id;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
      return null;
    }
    throw err;
  }
}

const MEMBER_EMAIL = 'v2-3-pre-trade.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'V2_3-PreTradePwd-2026!';

let member: SeededUser | null = null;

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

test.describe('V2.3 PreTradeCheck — auth-gate + happy-path persist + auto-link + triggers UI', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'V2_3',
      lastName: 'PreTrade',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('anon is bounced to /login on /pre-trade/new', async ({ page }) => {
    await page.goto('/pre-trade/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('CAPTURE + PERSIST: a PreTradeCheck round-trips through Prisma V2.3 schema', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const check = await db.preTradeCheck.create({
      data: {
        userId: member.id,
        reasonToTrade: 'edge',
        emotionLabel: 'calme',
        planAlignment: true,
        stopLossPredefined: true,
      },
      select: {
        id: true,
        userId: true,
        reasonToTrade: true,
        emotionLabel: true,
        planAlignment: true,
        stopLossPredefined: true,
        linkedTradeId: true,
        createdAt: true,
      },
    });

    expect(check.userId).toBe(member.id);
    expect(check.reasonToTrade).toBe('edge');
    expect(check.emotionLabel).toBe('calme');
    expect(check.planAlignment).toBe(true);
    expect(check.stopLossPredefined).toBe(true);
    // linkedTradeId is nullable + has NO FK to trades (race-safe P2025 invariant
    // documented at schema.prisma:1532-1537 — scar I1). A fresh check starts
    // unlinked.
    expect(check.linkedTradeId).toBeNull();
    expect(check.createdAt).toBeInstanceOf(Date);
  });

  test('AUTO-LINK: linkRecentCheckToTrade pairs a check with a recent Trade (15 min window)', async () => {
    if (!member) throw new Error('seed missing');

    // 1. Create a fresh, unlinked PreTradeCheck (within the 15 min window).
    const check = await db.preTradeCheck.create({
      data: {
        userId: member.id,
        reasonToTrade: 'edge',
        emotionLabel: 'calme',
        planAlignment: true,
        stopLossPredefined: true,
      },
      select: { id: true },
    });

    // 2. Create an open Trade for the same member (carbone `seedTradeHistory`
    //    fields shape — `emotionBefore` is the legacy singular array name in
    //    the J2 Trade schema, not `emotionsBefore`).
    const trade = await db.trade.create({
      data: {
        userId: member.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date(),
        entryPrice: 1.085,
        lotSize: 0.1,
        plannedRR: 2.5,
        emotionBefore: ['calm'],
        planRespected: true,
      },
      select: { id: true },
    });

    // 3. Auto-link should pick the recent unlinked check and stamp linkedTradeId.
    const linkedCheckId = await linkRecentCheckToTradeInline(member.id, trade.id);
    expect(linkedCheckId).toBe(check.id);

    const updated = await db.preTradeCheck.findUnique({
      where: { id: check.id },
      select: { linkedTradeId: true },
    });
    expect(updated?.linkedTradeId).toBe(trade.id);
  });

  test('AUTO-LINK: no recent unlinked check → returns null', async () => {
    if (!member) throw new Error('seed missing');

    // Establish the precondition DETERMINISTICALLY rather than assuming it.
    // Earlier tests in this serial describe (workers:1, cleanup only in
    // afterAll) leave UNLINKED checks behind — the "CAPTURE + PERSIST" test
    // creates a check that is never linked. Without this wipe, that stale
    // unlinked check is still inside the 15-min window, so the inline link
    // helper finds + links it and returns a non-null id → flaky failure
    // (masked by retries: the failed attempt links the row, the retry then
    // sees none). Deleting the member's pre-trade checks first makes "no
    // recent unlinked check" a real, order-independent precondition.
    await db.preTradeCheck.deleteMany({ where: { userId: member.id } });

    const newTrade = await db.trade.create({
      data: {
        userId: member.id,
        pair: 'GBPUSD',
        direction: 'short',
        session: 'newyork',
        enteredAt: new Date(),
        entryPrice: 1.265,
        lotSize: 0.1,
        plannedRR: 2.0,
        emotionBefore: ['focused'],
        planRespected: true,
      },
      select: { id: true },
    });

    const linkedCheckId = await linkRecentCheckToTradeInline(member.id, newTrade.id);
    expect(linkedCheckId).toBeNull();
  });

  test('RENDER: /pre-trade/new shows the wizard heading for an authed member', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/pre-trade/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/pre-trade\/new/);

    // V2.3.1 hardening : page-level `<h1 id="ptw-heading">` is the form's
    // `aria-labelledby` target. The wizard renders inside a Server Component
    // host page.
    await expect(page.locator('h1#ptw-heading')).toBeVisible();

    // No Next dev-overlay error dialog mounted.
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /dashboard surfaces Trigger A Card (pre-trade-heading)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/dashboard/);

    // ADR-003 Trigger A : visible h2 heading lime calme positioned ABOVE the
    // Journal section. Pattern carbone `<section aria-labelledby>` V1.12 P7.
    const heading = page.locator('h2#pre-trade-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/Pause 30 secondes/i);

    // Anchor the trigger link to confirm the card is wired to /pre-trade/new
    // (not a stale stub).
    await expect(page.locator('a[href="/pre-trade/new"]').first()).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /journal/new surfaces the live pre-trade day status (todo|done)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/journal/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/journal\/new/);

    // ADR-003 Trigger B, live variant : the static banner became
    // `PreTradeTodayStatus` (two calm states). Whether THIS member already has
    // a check today depends on sibling tests in this file (the persist test
    // creates one via Prisma), so both states are legitimate here — assert the
    // rendered copy matches whichever state the component reports.
    const status = page.locator('[data-slot="pre-trade-today-status"]');
    await expect(status).toBeVisible();
    const state = await status.getAttribute('data-state');
    if (state === 'done') {
      await expect(status).toContainText(/Pré-trade du jour fait à \d{1,2}h\d{2}/);
      // Done state links to the recap, not to a new check.
      await expect(status.locator('a[href="/patterns"]')).toBeVisible();
    } else {
      expect(state).toBe('todo');
      await expect(status).toContainText(/Pense à ton pré-trade/);
      await expect(status).toContainText(/pause de 30 secondes/i);
      // Anchor link to /pre-trade/new + aria-label confirming the destination.
      await expect(page.locator('a[href="/pre-trade/new"][aria-label*="pré-trade"]')).toBeVisible();
    }

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
