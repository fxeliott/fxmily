import { existsSync } from 'node:fs';

import { chromium, dismissCookieBannerOn, expect, test } from './fixtures';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * F5 — Member moderation, exercised END TO END against real Postgres through
 * the real admin UI. Proves the deliverables Eliott asked for:
 *
 *   A. SELF-GUARD — the admin's own Modération tab shows the "tu ne peux pas te
 *      suspendre toi-même" notice and offers NO suspend control.
 *
 *   B. SUSPEND (with motif) → REINSTATE round-trip, proving the WHOLE chain:
 *      - the suspend flips the status banner + records the motif + appends the
 *        history row (and surfaces the lifted success notice — RC P1-1 fix),
 *      - a member who was LOGGED IN at suspend time is EJECTED on his next
 *        navigation (live JWT torn down by the tokenVersion bump),
 *      - a fresh login attempt is REFUSED while suspended (authorize blocks
 *        non-active),
 *      - the DB carries status=suspended + an incremented tokenVersion + a
 *        `suspended` event with the motif,
 *      - reinstate flips the banner back, appends a `reinstated` row, and the
 *        member can log in AND reach /dashboard again,
 *      - the DB carries status=active again.
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`. Runs on chromium + mobile-iphone-15.
 */

const SUSPEND_MOTIF = 'Non-renouvellement de l’abonnement (motif e2e F5).';

let admin: SeededUser | null = null;
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

async function tokenVersionOf(userId: string): Promise<number> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  if (!row) throw new Error(`user ${userId} vanished`);
  return row.tokenVersion;
}

test.describe('F5 — Modération de membres (admin)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'F5Admin' });
    member = await seedMemberUser({ firstName: 'F5Member' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
  });

  test('A — l’onglet Modération de l’admin lui-même affiche le garde-fou self, sans bouton suspendre', async ({
    page,
    request,
  }) => {
    if (!admin) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/admin/members/${admin.id}?tab=moderation`);

    const tab = page.getByRole('main').getByRole('link', { name: 'Modération' });
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Tu ne peux pas suspendre ton propre compte.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspendre le membre' })).toBeHidden();
  });

  test('B — suspendre (avec motif) éjecte la session vivante + bloque la reconnexion, puis réintégrer restaure l’accès', async ({
    page,
    request,
    browser,
  }) => {
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');
    const memberUser = member;
    const adminUser = admin;

    // --- MEMBER: log in on the default page and prove /dashboard is reachable.
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/); // authenticated → not bounced

    const versionBefore = await tokenVersionOf(memberUser.id);

    // --- ADMIN: separate browser context (so the member's live cookie survives).
    const adminContext = await browser.newContext();
    try {
      const adminPage = await adminContext.newPage();
      await dismissCookieBannerOn(adminPage);
      await adminPage.goto('/login');
      await loginAs(adminPage, adminContext.request, adminUser.email, adminUser.password);

      await adminPage.goto(`/admin/members/${memberUser.id}?tab=moderation`);
      await expect(adminPage.getByRole('heading', { name: 'Membre actif' })).toBeVisible();

      // Suspend WITH a motif (two-step confirm). Type the motif key-by-key
      // (`pressSequentially`, NOT `fill`): the textarea is a React *controlled*
      // input, and on WebKit (the iPhone-15 project) Playwright's one-shot
      // `fill` sets the DOM value without reliably committing React's `onChange`
      // state — so the very next re-render (toggling the confirm step) re-applies
      // `value={reason}` (still '') and silently wipes the field, posting an
      // empty motif. Typing fires `onChange` per character (exactly like a real
      // user), so the committed state matches the field. `toHaveValue` then pins
      // that the value survives into the submit.
      const motifBox = adminPage.getByLabel('Motif (optionnel)');
      await motifBox.click();
      await motifBox.pressSequentially(SUSPEND_MOTIF);
      await expect(motifBox).toHaveValue(SUSPEND_MOTIF);
      await adminPage.getByRole('button', { name: 'Suspendre le membre' }).click();
      await adminPage.getByRole('button', { name: 'Confirmer la suspension' }).click();

      // Lifted success notice (RC P1-1) — assert the live `role="status"` node
      // specifically (the same copy also renders visibly, so a bare getByText
      // would double-match) — then the flipped banner.
      await expect(
        adminPage.getByRole('status').filter({ hasText: 'accès révoqué immédiatement' }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(adminPage.getByRole('heading', { name: 'Membre suspendu' })).toBeVisible({
        timeout: 15_000,
      });

      // AUTHORITATIVE motif proof: the motif is persisted in the SAME
      // transaction as the status flip — the DB is the source of truth. (The
      // banner derives its motif from a server re-fetch of this very row, so a
      // degraded local dev-server can lag the RSC refresh; the DB never lies.)
      const persisted = await db.memberModerationEvent.findFirst({
        where: { memberId: memberUser.id, action: 'suspended' },
        orderBy: { createdAt: 'desc' },
        select: { reason: true },
      });
      expect(persisted?.reason).toBe(SUSPEND_MOTIF);

      // UI proof: the suspended banner surfaces that motif. Generous timeout —
      // this gates on the post-Server-Action RSC refresh (same class of wait as
      // the success notice above), not on a single paint.
      await expect(adminPage.getByText(SUSPEND_MOTIF).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await adminContext.close();
    }

    // --- DB proof: status flipped, tokenVersion bumped, event recorded w/ motif.
    const afterSuspend = await db.user.findUnique({
      where: { id: memberUser.id },
      select: { status: true, tokenVersion: true },
    });
    expect(afterSuspend?.status).toBe('suspended');
    expect(afterSuspend?.tokenVersion).toBe(versionBefore + 1);
    const suspendEvent = await db.memberModerationEvent.findFirst({
      where: { memberId: memberUser.id, action: 'suspended' },
      orderBy: { createdAt: 'desc' },
      select: { reason: true, actorId: true },
    });
    expect(suspendEvent?.reason).toBe(SUSPEND_MOTIF);
    expect(suspendEvent?.actorId).toBe(adminUser.id);

    // --- EJECTION: the member's LIVE session is torn down on next navigation.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);

    // --- RECONNECTION BLOCKED: a fresh login is refused while suspended.
    // Use a CLEAN context: the `request` fixture jar still holds the member's
    // original (now stale) session cookie from the initial login, which would
    // mask a rejected re-login. `authorize` returns null for a non-active user,
    // so no session cookie is ever set → loginAs throws.
    const blockedContext = await browser.newContext();
    try {
      const blockedPage = await blockedContext.newPage();
      await expect(
        loginAs(blockedPage, blockedContext.request, memberUser.email, memberUser.password),
      ).rejects.toThrow();
    } finally {
      await blockedContext.close();
    }

    // --- ADMIN: reinstate (separate context again).
    const adminContext2 = await browser.newContext();
    try {
      const adminPage = await adminContext2.newPage();
      await dismissCookieBannerOn(adminPage);
      await adminPage.goto('/login');
      await loginAs(adminPage, adminContext2.request, adminUser.email, adminUser.password);

      await adminPage.goto(`/admin/members/${memberUser.id}?tab=moderation`);
      await expect(adminPage.getByRole('heading', { name: 'Membre suspendu' })).toBeVisible();
      await adminPage.getByRole('button', { name: 'Réintégrer le membre' }).click();

      await expect(
        adminPage.getByRole('status').filter({ hasText: 'de nouveau se connecter' }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(adminPage.getByRole('heading', { name: 'Membre actif' })).toBeVisible();
      // History now carries both transitions (exact: the pill text is its own
      // node — avoids matching the success notice / hero pills).
      await expect(adminPage.getByText('Réintégré', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Suspendu', { exact: true })).toBeVisible();
    } finally {
      await adminContext2.close();
    }

    // --- DB proof: back to active.
    const afterReinstate = await db.user.findUnique({
      where: { id: memberUser.id },
      select: { status: true },
    });
    expect(afterReinstate?.status).toBe('active');

    // --- ACCESS RESTORED: a fresh login (clean context) reaches /dashboard.
    const restoredContext = await browser.newContext();
    try {
      const restoredPage = await restoredContext.newPage();
      await dismissCookieBannerOn(restoredPage);
      await restoredPage.goto('/login');
      await loginAs(restoredPage, restoredContext.request, memberUser.email, memberUser.password);
      await restoredPage.goto('/dashboard');
      await expect(restoredPage).not.toHaveURL(/\/login/);
    } finally {
      await restoredContext.close();
    }
  });
});
