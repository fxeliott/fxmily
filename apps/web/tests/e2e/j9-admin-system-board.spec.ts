import { expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedAdminUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * J9 — the `/admin/system` worker board, exercised for real.
 *
 * Why this file exists. The board is the ONLY surface that turns "the AI stopped
 * generating" into something a human sees, and J9 rewrote it — a second host
 * profile, a new pipeline, new labels. It had no end-to-end test at all: every
 * guarantee was pinned by unit tests against a mocked Prisma, so nothing proved
 * the page actually RENDERS with those rows in a real database.
 *
 * What it pins, in a real browser against real rows:
 *   - the admin gate (an anonymous visitor never sees the board) ;
 *   - the doublon window: while BOTH machines run, the board must NOT keep
 *     claiming the batches run on the local machine. `WORKER_HOST` stays `pc`
 *     for the whole switchover by construction, so this state is invisible to
 *     the flag and can only be inferred from the labels the server watchdog
 *     alone emits.
 *   - the plain PC state still reads as before (no regression for the 99% of
 *     the time when there is no switchover in flight).
 *
 * NOTE (scar GG-CI): import `@/lib/db` directly, never a domain service module —
 * those carry `import 'server-only'` and Playwright has no alias for it.
 */

const ADMIN_PASSWORD = 'J9BoardCheck-2026!';
const WATCHDOG = 'worker.watchdog.heartbeat';

/** Remove only the heartbeat rows this spec injected. */
async function clearWatchdogRows(): Promise<void> {
  await db.auditLog.deleteMany({ where: { action: WATCHDOG } });
}

test.afterAll(async () => {
  await clearWatchdogRows();
  await cleanupTestUsers();
});

test.describe('J9 — /admin/system worker board', () => {
  test('an anonymous visitor never reaches the board', async ({ page }) => {
    const res = await page.goto('/admin/system');
    // Either the proxy redirected to /login, or we are simply not on the board.
    expect(page.url()).not.toContain('/admin/system');
    expect(res?.status() ?? 200).toBeLessThan(500);
  });

  test('during the doublon window the board stops claiming "machine locale"', async ({
    page,
    request,
  }) => {
    await clearWatchdogRows();
    const admin = await seedAdminUser({ password: ADMIN_PASSWORD });

    // The server watchdog, alive and ticking, with the ONE label only it emits.
    await db.auditLog.create({
      data: {
        action: WATCHDOG,
        metadata: {
          tasksChecked: 7,
          tasksOk: 7,
          repaired: 0,
          errors: 1,
          errorLabels: ['claude_auth:observation_pending'],
          watchdogVersion: 'j9-1.0-obs',
        },
      },
    });

    // `loginAs` needs a real origin in the page URL first (about:blank guard) —
    // documented in a11y-core.spec.ts. Without it the CSRF fetch targets a closed context.
    await page.goto('/login');
    await loginAs(page, request, admin.email, ADMIN_PASSWORD);
    await page.goto('/admin/system');

    const heading = page.locator('#worker-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('bascule en cours');
    // The lie this test exists to prevent.
    await expect(heading).not.toContainText('machine locale');
    await expect(page.getByText('Les deux machines tournent')).toBeVisible();
  });

  test('with no server watchdog the board reads as the local machine, unchanged', async ({
    page,
    request,
  }) => {
    await clearWatchdogRows();
    const admin = await seedAdminUser({ password: ADMIN_PASSWORD });

    // A PC-only watchdog tick: healthy, no server-only label.
    await db.auditLog.create({
      data: {
        action: WATCHDOG,
        metadata: { tasksChecked: 6, tasksOk: 6, repaired: 0, errors: 0, watchdogVersion: '1.1.0' },
      },
    });

    // `loginAs` needs a real origin in the page URL first (about:blank guard) —
    // documented in a11y-core.spec.ts. Without it the CSRF fetch targets a closed context.
    await page.goto('/login');
    await loginAs(page, request, admin.email, ADMIN_PASSWORD);
    await page.goto('/admin/system');

    const heading = page.locator('#worker-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('machine locale');
    await expect(heading).not.toContainText('bascule en cours');
  });
});
