/**
 * S4 §31 « photos » pluriel — the member can attach MULTIPLE analysis captures
 * at entry, on top of the mandatory primary capture. Exercised END TO END
 * against real Postgres through the real UI:
 *
 *   1. drive the 6-step wizard with valid values ;
 *   2. step 6 — upload the primary capture (first file input) THEN two extra
 *      photos through the §31 gallery uploader (it remounts after each add) ;
 *   3. submit → redirect /journal/[id] ;
 *   4. the detail page shows the primary image + « Photos d'analyse
 *      additionnelles (2) » + 2 thumbnails ;
 *   5. the DB carries exactly 2 TradeMedia rows (kind=entry) under the
 *      member's own storage prefix.
 *
 * Mirrors s4-journal-happy-path (same fixture, helpers, determinism canon).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

const FIXTURE_PNG = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'mt5-history-account-a.png',
);

let member: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return { ok: false, reason: `Chromium binary not found at ${exec || '(unresolved)'}` };
  }
  return { ok: true };
}

test.describe('S4 — /journal multi-photo : plusieurs captures d’analyse à l’entrée (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Multi' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('upload primaire + 2 photos additionnelles → persistées + affichées (TradeMedia)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/journal/new');
    const wizardHeading = page.locator('h1#wizard-heading');

    // Step 1/6. `enteredAt` is SSR-empty and filled by the mount effect; wait
    // for it before clicking « Suivant » or step-1 validation rejects the
    // advance (the happy-path reaches the wizard via the CTA, which gives the
    // effect time — a direct goto + fast drive on mobile would race it).
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await expect(page.locator('input[type="datetime-local"]').first()).not.toHaveValue('');
    await page.getByLabel('Paire', { exact: true }).fill('EURUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();
    // Step 2/6
    await expect(wizardHeading).toHaveText('Direction & session');
    await page.getByRole('radio', { name: 'Long', exact: true }).click();
    await page.getByRole('radio', { name: /^Londres/ }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();
    // Step 3/6
    await expect(wizardHeading).toHaveText('Prix & taille');
    await page.getByLabel("Prix d'entrée").fill('1.085');
    await page.getByLabel('Taille (lots / contrats)').fill('0.10');
    await page.getByLabel('Stop-loss (optionnel mais recommandé)').fill('1.08');
    await page.getByRole('button', { name: /Suivant/ }).click();
    // Step 4/6
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();
    // Step 5/6
    await expect(wizardHeading).toHaveText('Discipline & émotion');
    await page.getByRole('group', { name: 'Plan respecté ?' }).getByText('Oui').click();
    await page.getByRole('group', { name: 'Hedge respecté ?' }).getByText('N/A').click();
    await page.getByRole('button', { name: 'Calme', exact: true }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 6/6 — primary capture (first file input) gates the submit.
    await expect(wizardHeading).toHaveText('Capture avant entrée');
    const submitBtn = page.getByRole('button', { name: 'Sauvegarder le trade' });
    await expect(submitBtn).toBeDisabled();
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PNG);
    await expect(page.getByAltText('Capture avant entrée')).toBeVisible({ timeout: 15_000 });
    await expect(submitBtn).toBeEnabled();

    // §31 — two ADDITIONAL photos through the gallery uploader (the 2nd file
    // input ; it remounts after each add so we re-query it each time).
    const removeButtons = page.getByRole('button', { name: /Retirer la photo additionnelle/ });
    await page.locator('input[type="file"]').nth(1).setInputFiles(FIXTURE_PNG);
    await expect(removeButtons).toHaveCount(1);
    await page.locator('input[type="file"]').nth(1).setInputFiles(FIXTURE_PNG);
    await expect(removeButtons).toHaveCount(2);
    await expect(page.getByText('2/4 · optionnel')).toBeVisible();
    // The whitelisted thumbnail src still resolves to our upload route — proves
    // the CodeQL safeUploadUrl guard didn't blank a legitimate URL.
    await expect(page.getByAltText(/Photo d.analyse additionnelle 1/)).toHaveAttribute(
      'src',
      /^\/api\/uploads\/trades\//,
    );

    // Submit → detail page.
    await submitBtn.click();
    await expect(page).toHaveURL(/\/journal\/[a-z0-9]{20,40}$/, { timeout: 30_000 });

    await expect(page.getByAltText('Capture avant entrée du trade EURUSD')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      // apostrophe-agnostic (`&apos;` renders U+0027, not the curly U+2019).
      page.getByRole('heading', { name: /Photos d.analyse additionnelles \(2\)/ }),
    ).toBeVisible();
    await expect(page.getByAltText(/Photo d'analyse \d du trade EURUSD/)).toHaveCount(2);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

    // Real DB: exactly 2 TradeMedia rows (kind=entry) under the member's prefix.
    const trade = await db.trade.findFirst({
      where: { userId: member.id, pair: 'EURUSD' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, media: { select: { kind: true, fileKey: true } } },
    });
    expect(trade).not.toBeNull();
    expect(trade!.media).toHaveLength(2);
    for (const m of trade!.media) {
      expect(m.kind).toBe('entry');
      expect(m.fileKey).toMatch(new RegExp(`^trades/${member.id}/`));
    }
  });
});
