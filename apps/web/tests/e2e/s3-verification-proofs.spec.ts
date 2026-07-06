/**
 * S3 DoD — Vérification & Honnêteté radicale (SPEC §33), member surface
 * exercised END TO END against real Postgres through the real UI:
 *
 *   1. a member declares a broker account on /verification (Server Action →
 *      real `broker_accounts` row, detectedByAI=false);
 *   2. the member uploads a real MT5-history PNG proof attached to that
 *      account (POST /api/uploads kind=mt5-proof → real `mt5_account_proofs`
 *      row with a SERVER-computed SHA-256, ocrStatus=pending);
 *   3. re-uploading the SAME bytes is refused (anti-double-upload
 *      `@@unique([memberId, fileHash])` → 409 surfaced calmly in the UI).
 *
 * The fixtures are synthetic MT5-history screenshots (the same images used by
 * the vision-pipeline runtime proof) — real PNG bytes, so the server-side
 * magic-byte sniff passes like a genuine member capture would.
 *
 * Pre-requisites (same as the other DB-backed e2e): real Postgres at
 * DATABASE_URL with migrations applied; without it the suite fails fast at
 * import (the `@/lib/env` Zod validation throws).
 */

import path from 'node:path';

import { expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { db } from '@/lib/db';
import { loginAs } from '@/test/e2e-auth';

// Playwright runs with cwd = apps/web; `__dirname` is unreliable here (the
// spec is transpiled next to the generated client), so anchor on the cwd.
const FIXTURE_A = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'mt5-history-account-a.png');

test.describe('S3 — /verification : comptes + preuves MT5 (real DB)', () => {
  let member: SeededUser;

  test.beforeEach(async () => {
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'Verif' });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
  });

  test('déclare un compte, téléverse une preuve, refuse le doublon', async ({ page, request }) => {
    await loginAs(page, request, member.email, member.password);

    // --- Page loads with calm copy (anti-survente §33.6: no "vérifié 100%").
    await page.goto('/verification');
    await expect(page.getByRole('heading', { name: 'Ta réalité de trading' })).toBeVisible();
    await expect(page.getByText(/vérifié à 100\s?%/i)).toHaveCount(0);

    // PR-C sections render their calm empty states for a fresh member —
    // constancy (no score yet) + écarts (none detected). Anti-Black-Hat:
    // nothing red, nothing urgent on a blank account.
    await expect(page.getByRole('heading', { name: 'Ta constance' })).toBeVisible();
    await expect(page.getByText(/il commence quand tu commences/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tes écarts' })).toBeVisible();
    await expect(page.getByText(/Aucun écart détecté/i)).toBeVisible();

    // --- 1. Declare a broker account through the real form.
    await page.getByLabel('Nom du compte').fill('FTMO Challenge 100k');
    await page.getByLabel('Broker (optionnel)').fill('FTMO');
    await page.getByRole('group', { name: 'Type de compte' }).getByText('Prop firm').click();
    await page.getByRole('button', { name: /Déclarer ce compte/i }).click();

    // The account card appears (server revalidation) + the real DB row exists.
    await expect(page.getByText('FTMO Challenge 100k', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    const account = await db.brokerAccount.findFirst({
      where: { memberId: member.id, label: 'FTMO Challenge 100k' },
    });
    expect(account).not.toBeNull();
    expect(account?.detectedByAI).toBe(false);
    expect(account?.type).toBe('prop_firm');

    // --- 2. Upload a real MT5-history PNG proof attached to that account.
    await page.getByLabel('Compte concerné (optionnel)').selectOption(account!.id);
    await page.getByLabel('Type de compte (optionnel)').selectOption('prop_firm');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_A);

    await expect(page.getByText(/Capture reçue/i)).toBeVisible({ timeout: 15_000 });
    // The proof row exists with a server-computed 64-hex SHA-256, pending OCR.
    const proof = await db.mt5AccountProof.findFirst({ where: { memberId: member.id } });
    expect(proof).not.toBeNull();
    expect(proof?.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof?.ocrStatus).toBe('pending');
    expect(proof?.brokerAccountId).toBe(account!.id);
    expect(proof?.fileKey).toMatch(new RegExp(`^proofs/${member.id}/`));

    // The proof list renders the pending status pill after refresh.
    await expect(page.getByText('En attente d’analyse')).toBeVisible({ timeout: 10_000 });

    // --- S3 §33 enrichments render at REAL render (DoD #5):
    // (a) « journal de preuves horodaté & inaltérable » — the uploaded proof now
    //     shows its SHA-256 empreinte (truncated) next to the timestamp.
    await expect(page.getByText(/Empreinte\s+[a-f0-9]{10}/).first()).toBeVisible({
      timeout: 10_000,
    });

    // (b) « badge de niveau de confiance/cohérence par compte » — appears once
    //     the account is AI-detected with a confidence (the réalité-vs-déclaré
    //     signal). Promote the declared account and reload the server component.
    await db.brokerAccount.update({
      where: { id: account!.id },
      data: { detectedByAI: true, confidence: 0.9 },
    });
    await page.reload();
    await expect(page.getByText('Cohérence élevée').first()).toBeVisible({ timeout: 10_000 });

    // --- 3. Same bytes again → anti-double-upload 409, calm UI message.
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_A);
    await expect(page.getByText(/déjà été envoyée/i)).toBeVisible({ timeout: 15_000 });
    const proofCount = await db.mt5AccountProof.count({ where: { memberId: member.id } });
    expect(proofCount).toBe(1);
  });
});
