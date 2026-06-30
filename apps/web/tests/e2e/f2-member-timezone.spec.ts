/**
 * F2 — Per-member timezone, exercised END TO END against real Postgres through
 * the real wizard, the real member surface and the real settings picker.
 *
 *   A. WALL-CLOCK ROUND-TRIP — a member whose SET timezone is America/New_York
 *      logs a backtest at the wall-clock 14:30. The server must interpret that
 *      wall-clock in the MEMBER's set timezone (NY, EDT = UTC-4), NOT the test
 *      browser's timezone, so:
 *        - the DB row's `enteredAt` is exactly 2026-05-06T18:30:00.000Z,
 *        - the training list card renders it BACK as 14:30 (member-local),
 *          never 18:30 (which is what a host-tz render would show).
 *      This is the decisive, host-timezone-independent proof of the F2 wiring
 *      (post raw wall-clock → server `memberWallClock`/`localWallClockToUtc`).
 *
 *   B. SETTINGS PICKER — the `/account/timezone` picker shows the member's
 *      current zone selected, stays INTERACTIVE while auto-saving (never
 *      `disabled` — disabling a focused control drops focus to <body>, WCAG
 *      2.4.3), and a change persists to the DB (read straight from the row).
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`. Runs on chromium + mobile-iphone-15 (WebKit).
 * Two independent seeded members so the settings mutation in B can never race
 * the backtest round-trip in A.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const FIXTURE_PNG = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'mt5-history-account-a.png',
);

// 14:30 wall-clock on 2026-05-06 in New York (EDT, UTC-4) = 18:30Z. A past date
// (well before "now") so the wizard's "no future date" guard always passes.
const ENTERED_WALL_CLOCK = '2026-05-06T14:30';
const EXPECTED_UTC_ISO = '2026-05-06T18:30:00.000Z';

let backtestMember: SeededUser | null = null;
let settingsMember: SeededUser | null = null;

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

async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

test.describe('F2 — Fuseau horaire par membre', () => {
  // Reduced-motion → every wizard step transition drops to duration:0 so the
  // « Suivant » button is actionable the instant a step renders (canon F1).
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    backtestMember = await seedMemberUser({ firstName: 'F2Back', timezone: 'America/New_York' });
    settingsMember = await seedMemberUser({ firstName: 'F2Set', timezone: 'America/New_York' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    backtestMember = null;
    settingsMember = null;
  });

  test('A — un backtest saisi à 14:30 (membre New York) est stocké en 18:30Z et réaffiché 14:30', async ({
    page,
    request,
  }) => {
    if (!backtestMember) throw new Error('seed missing — beforeAll did not run');
    const memberUser = backtestMember;

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);

    await page.goto('/training/new');
    const wizardHeading = page.locator('h1#training-wizard-heading');

    // Step 1/7 — set a DETERMINISTIC entry wall-clock (overriding the "now in NY"
    // prefill). Gate on the prefilled value first so the bundle is hydrated
    // before we drive React's controlled datetime-local input.
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await expect(page.locator('#enteredAt')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, {
      timeout: 30_000,
    });
    await page.locator('#enteredAt').fill(ENTERED_WALL_CLOCK);
    await expect(page.locator('#enteredAt')).toHaveValue(ENTERED_WALL_CLOCK);
    await page.getByLabel('Paire', { exact: true }).fill('GBPUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 2/7 — Capture (mandatory). No TradingView link (covered by F1).
    await expect(wizardHeading).toHaveText('Capture de ton analyse');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
    await expect(page.getByAltText("Capture de l'analyse du backtest")).toBeVisible({
      timeout: 45_000,
    });
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 3/7 — R:R prévu (default valid).
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 4/7 — Résultat (optional; "Aucun" is the default checked radio).
    await expect(wizardHeading).toHaveText('Résultat du backtest');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 5/7 — Respect du système (gated — must answer).
    await expect(wizardHeading).toHaveText('Respect du système');
    await page.getByRole('group', { name: 'Système respecté ?' }).getByText('Oui').click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 6/7 — Checklist process (optional — leave untouched).
    await expect(wizardHeading).toHaveText('Checklist process');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 7/7 — Leçon tirée → submit.
    await expect(wizardHeading).toHaveText('Leçon tirée');
    await page.locator('#lessonLearned').fill('Round-trip fuseau (e2e F2).');
    const submitBtn = page.getByRole('button', { name: 'Enregistrer le backtest' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page).toHaveURL(/\/training$/, { timeout: 30_000 });

    // DECISIVE proof — the wall-clock was interpreted in the member's SET zone
    // (NY), independent of whatever timezone the test browser runs in.
    const tt = await db.trainingTrade.findFirst({
      where: { userId: memberUser.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, enteredAt: true, pair: true },
    });
    expect(tt).not.toBeNull();
    expect(tt?.pair).toBe('GBPUSD');
    expect(tt?.enteredAt.toISOString()).toBe(EXPECTED_UTC_ISO);

    // DISPLAY proof — the list card renders the instant BACK in the member's
    // zone: 14:30 (NY), never 18:30 (UTC). Host-tz-independent.
    await expect(page.getByText(/14:30/).first()).toBeVisible();
    await expect(page.getByText(/18:30/)).toHaveCount(0);
  });

  test('B — le sélecteur /account/timezone montre la zone du membre, reste interactif et persiste un changement', async ({
    page,
    request,
  }) => {
    if (!settingsMember) throw new Error('seed missing — beforeAll did not run');
    const memberUser = settingsMember;

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);

    await page.goto('/account/timezone');

    const select = page.getByRole('combobox');
    await expect(select).toBeVisible({ timeout: 30_000 });
    // Reads straight from the DB row (seeded NY).
    await expect(select).toHaveValue('America/New_York');
    // A11y regression guard: the picker is NEVER disabled (focus must not drop).
    await expect(select).toBeEnabled();

    // Change → optimistic + auto-save. The success line confirms the write.
    await select.selectOption('Europe/Paris');
    await expect(page.getByText('Fuseau horaire enregistré.')).toBeVisible({ timeout: 15_000 });

    // DB-authoritative: the new zone persisted.
    const row = await db.user.findUnique({
      where: { id: memberUser.id },
      select: { timezone: true },
    });
    expect(row?.timezone).toBe('Europe/Paris');
  });
});
