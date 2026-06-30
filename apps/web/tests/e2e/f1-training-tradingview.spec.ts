/**
 * F1 — Mode Entraînement : OPTIONAL TradingView link beside the mandatory
 * analysis screenshot, exercised END TO END against real Postgres through the
 * real wizard + detail UI.
 *
 *   A. HAPPY PATH — a member drives the backtest wizard, uploads the mandatory
 *      screenshot AND pastes a TradingView snapshot link, submits, and:
 *        - the DB row carries the pasted `tradingViewUrl`,
 *        - the member detail page renders it as a real clickable anchor
 *          (target=_blank + rel="noopener noreferrer"),
 *        - the list card surfaces the "Analyse TradingView jointe" indicator.
 *
 *   B. CLIENT GATE — an off-host URL (not tradingview.com) is refused at the
 *      wizard's per-step validation: the member cannot advance past the capture
 *      step and a field error is shown. (The server-side Zod guard — the real
 *      authority — is covered exhaustively in the unit suites.)
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`. Runs on chromium + mobile-iphone-15 (WebKit).
 * The TradingView URL is typed with `pressSequentially` (NOT `fill`): the input
 * is a React *controlled* field and on WebKit a one-shot `fill` sets the DOM
 * value without reliably committing React's `onChange` state (canon F5), which
 * would drop the link before submit. Typing fires `onChange` per character.
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

const TV_URL = 'https://www.tradingview.com/x/NQe0OrXz/';

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

async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

test.describe('F1 — Lien TradingView optionnel (Mode Entraînement)', () => {
  // Emulate `prefers-reduced-motion: reduce` per test (typed Page API —
  // `test.use({ reducedMotion })` is rejected by the base test's option type).
  // The wizard honours framer-motion's useReducedMotion() → every step
  // transition drops to `duration: 0`, so the « Suivant » button is stable the
  // instant a step renders (no x-translate entrance animation fighting
  // Playwright's actionability check). A real user path (accessibility setting),
  // not a flakiness band-aid.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'F1Member' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('A — un membre colle un lien TradingView en plus de la capture ; il persiste + s’affiche cliquable', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const memberUser = member;

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);

    await page.goto('/training/new');
    const wizardHeading = page.locator('h1#training-wizard-heading');

    // Step 1/7 — Quand & quelle paire (enteredAt pre-filled).
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    // Gate on client hydration BEFORE driving the wizard: `enteredAt` is filled
    // by the post-mount restore effect, so a non-empty value proves the bundle
    // loaded. The SSR heading renders before hydration — clicking « Suivant »
    // too early no-ops (validateStep sees an empty enteredAt → stays on step 1).
    // Generous timeout absorbs a cold `next dev` compile.
    await expect(page.locator('#enteredAt')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, {
      timeout: 30_000,
    });
    await page.getByLabel('Paire', { exact: true }).fill('GBPUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 2/7 — Capture (mandatory) + the OPTIONAL TradingView link beside it.
    await expect(wizardHeading).toHaveText('Capture de ton analyse');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
    await expect(page.getByAltText("Capture de l'analyse du backtest")).toBeVisible({
      timeout: 45_000,
    });
    // Controlled input → type the URL char-by-char (WebKit-safe, canon F5).
    const urlBox = page.getByLabel('Lien TradingView (optionnel)');
    await urlBox.click();
    await urlBox.pressSequentially(TV_URL);
    await expect(urlBox).toHaveValue(TV_URL);
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
    await page.locator('#lessonLearned').fill('J’ai attendu la confirmation (e2e F1).');
    const submitBtn = page.getByRole('button', { name: 'Enregistrer le backtest' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Redirect to the standalone training landing.
    await expect(page).toHaveURL(/\/training$/, { timeout: 30_000 });

    // DB-authoritative proof: the pasted link round-tripped onto the row.
    const tt = await db.trainingTrade.findFirst({
      where: { userId: memberUser.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tradingViewUrl: true, pair: true },
    });
    expect(tt).not.toBeNull();
    expect(tt?.pair).toBe('GBPUSD');
    expect(tt?.tradingViewUrl).toBe(TV_URL);

    // The list card surfaces the "jointe" indicator.
    await expect(page.getByText('Analyse TradingView jointe').first()).toBeVisible();

    // The detail page renders a REAL clickable anchor (new tab, hardened rel).
    await page.goto(`/training/${tt!.id}`, { waitUntil: 'domcontentloaded' });
    const link = page.getByRole('link', { name: 'Ouvrir mon analyse sur TradingView' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', TV_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  });

  test('B — un lien hors tradingview.com est refusé au gate du wizard (capture déjà fournie)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const memberUser = member;

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);

    await page.goto('/training/new');
    const wizardHeading = page.locator('h1#training-wizard-heading');

    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await expect(page.locator('#enteredAt')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, {
      timeout: 30_000,
    });
    await page.getByLabel('Paire', { exact: true }).fill('EURUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Capture provided (so the screenshot requirement is satisfied) + a BAD URL.
    await expect(wizardHeading).toHaveText('Capture de ton analyse');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
    await expect(page.getByAltText("Capture de l'analyse du backtest")).toBeVisible({
      timeout: 45_000,
    });
    const urlBox = page.getByLabel('Lien TradingView (optionnel)');
    await urlBox.click();
    await urlBox.pressSequentially('https://evil.example.com/x/abc/');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // The off-host URL blocks the step: still on the capture step + a field error.
    await expect(wizardHeading).toHaveText('Capture de ton analyse');
    await expect(page.locator('#tradingViewUrl-error')).toBeVisible();
  });
});
