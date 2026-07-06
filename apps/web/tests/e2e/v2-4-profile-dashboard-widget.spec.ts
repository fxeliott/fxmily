/**
 * V2.4 — Profile dashboard status widget E2E (Session 2 hardening).
 *
 * The V2.4 profiling pipeline (interview → batch local Claude Opus 4.8 →
 * MemberProfile → /profile) was built but had NO entry point in the member
 * journey : /dashboard carried zero link to /onboarding/interview or /profile,
 * so a freshly-onboarded member never discovered the flagship "profilage
 * initial" (SPEC §28). The `ProfileStatusWidget` is the missing bridge. This
 * spec proves it surfaces the right state + routes correctly, in REAL (rendered
 * dashboard, real DB state).
 *
 * Two distinct seeded members keep the tests ORDER-INDEPENDENT (canon : never
 * an inter-test data dependency — `v1-5-mindset-check` flaky-fix 2026-06-02) :
 *   - `memberNew`      → no interview → widget state "not-started" (CTA).
 *   - `memberProfiled` → completed interview + MemberProfile → state "ready".
 *
 * Scar GG-CI : NEVER import `lib/onboarding-interview/service.ts` (it starts
 * with `import 'server-only'` → Playwright runtime crash). We seed via Prisma
 * directly through `@/lib/db`.
 *
 * No `waitForLoadState('networkidle')` (canon 2026-06-03 : Turbopack HMR socket
 * never settles → flaky). `goto` + `toBeVisible` auto-wait is deterministic.
 *
 * Skipping policy : skip with a clear message if Playwright Chromium is not
 * installed, rather than crashing (carbone J9 visual).
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const NEW_EMAIL = 'v2-4-profilewidget.new.e2e.test@fxmily.local';
const PROFILED_EMAIL = 'v2-4-profilewidget.profiled.e2e.test@fxmily.local';
const PASSWORD = 'V2_4-ProfileWidget-2026!';

let memberNew: SeededUser | null = null;
let memberProfiled: SeededUser | null = null;

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

test.describe('V2.4 Profile dashboard widget — surfaces the profiling pipeline in the member journey', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();

    memberNew = await seedMemberUser({
      email: NEW_EMAIL,
      password: PASSWORD,
      firstName: 'Nouvelle',
      lastName: 'Recrue',
    });

    memberProfiled = await seedMemberUser({
      email: PROFILED_EMAIL,
      password: PASSWORD,
      firstName: 'Profil',
      lastName: 'Pret',
    });

    // memberProfiled : completed interview + analyzed MemberProfile.
    const interview = await db.onboardingInterview.create({
      data: {
        userId: memberProfiled.id,
        instrumentVersion: 'v1',
        status: 'completed',
        completedAt: new Date(),
      },
      select: { id: true },
    });
    await db.memberProfile.create({
      data: {
        userId: memberProfiled.id,
        interviewId: interview.id,
        summary:
          'Trader discipliné qui progresse, encore sensible au FOMO en fin de session londonienne. Bon ancrage sur le process, à consolider sur la patience.',
        highlights: [
          { key: 'discipline', label: 'Respect du plan en hausse', evidence: ['« je note tout »'] },
        ],
        axesPrioritaires: ['patience', 'acceptation de l’incertitude', 'détachement du résultat'],
        claudeModelVersion: 'claude-opus-4-8',
        instrumentVersion: 'v1',
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    memberNew = null;
    memberProfiled = null;
  });

  test('anon is bounced to /login on /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('NEW member : dashboard widget shows the "Établis ton profil" CTA → /onboarding/interview', async ({
    page,
    request,
  }) => {
    if (!memberNew) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, memberNew.email, memberNew.password);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const widget = page.locator('[data-slot="profile-status-widget"]');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-state', 'not-started');
    await expect(widget).toContainText(/Établis ton profil/i);
    // The widget itself is the link to the interview entry point.
    await expect(widget).toHaveAttribute('href', '/onboarding/interview');

    // No Next dev-overlay error dialog mounted (render is clean).
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('PROFILED member : dashboard widget shows "Ton profil est prêt" → /profile', async ({
    page,
    request,
  }) => {
    if (!memberProfiled) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, memberProfiled.email, memberProfiled.password);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const widget = page.locator('[data-slot="profile-status-widget"]');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-state', 'ready');
    await expect(widget).toContainText(/Ton profil est prêt/i);

    // The "Voir mon profil" link routes into /profile (the previously-orphaned
    // page).
    const profileLink = widget.getByRole('link', { name: /Voir mon profil/i });
    await expect(profileLink).toBeVisible();
    await expect(profileLink).toHaveAttribute('href', '/profile');

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
