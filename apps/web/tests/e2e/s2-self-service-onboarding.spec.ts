/**
 * S2 DoD#1 — self-service signup → admin confirmation → onboarding → active
 * member, exercised END TO END against real Postgres through the real UI.
 *
 * Closes the challenge-#4 audit findings L3-01 + L3-03: the headline DoD#1
 * pipeline was fully wired and live in prod, but "testé EN RÉEL (pas en
 * théorie)" (brief §29) was met only by mocked/in-memory unit tests — every
 * existing e2e member was injected via `seedMemberUser` (direct insert),
 * bypassing the register/approve/onboard chain entirely.
 *
 * Two complementary real-DB flows. The raw invitation token is unrecoverable
 * after approval (only its SHA-256 hash is persisted, and the dev email
 * fallback's stdout is not captured by Playwright), so the chain is split:
 *   A. /rejoindre (public UI) → admin /admin/access-requests "Accepter" (UI)
 *      → assert the real DB transition (pending → approved + Invitation minted).
 *   B. a real minted Invitation → /onboarding/welcome (UI) → assert a real
 *      active member User row is created (exercises the server-only
 *      `completeOnboarding` account-creation path against Postgres).
 *
 * Pre-requisites (same as checkin-happy-path): real Postgres at DATABASE_URL,
 * migrations applied. Without `DATABASE_URL` the suite fails fast — the
 * `@/lib/env` Zod validation throws at import (`global-setup` only loads
 * dotenv; there is NO graceful DB-env skip), like every other DB-backed e2e.
 */

import { expect, test } from './fixtures';

import {
  cleanupAccessRequests,
  cleanupTestUsers,
  countInvitationsForEmail,
  getAccessRequestByEmail,
  getUserByEmail,
  seedAdminUser,
  seedInvitation,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

// 12+ chars, mixed, not in the common-password denylist (schemas/auth.ts).
const E2E_PASSWORD = 'Fxmily-E2E-Welcome-2026';

function uniqueTestEmail(tag: string): string {
  // Ends in the `.e2e.test@fxmily.local` domain so cleanup helpers catch it.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${tag}-${rand}.member.e2e.test@fxmily.local`;
}

test.describe('S2 DoD#1 — self-service signup → confirmation → onboarding (real DB)', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    await cleanupAccessRequests();
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    await cleanupAccessRequests();
  });

  test('A — a prospect requests access and an admin confirms it (pending → approved, invitation minted)', async ({
    page,
    request,
  }) => {
    const email = uniqueTestEmail('signup');

    // 1. Prospect fills the PUBLIC /rejoindre form (no auth).
    await page.goto('/rejoindre');
    await expect(page.getByRole('heading', { name: /Rejoindre Fxmily/i })).toBeVisible();
    await page.getByLabel('Prénom').fill('Prospect');
    // exact: true — "Prénom" contains the substring "nom", so a loose
    // getByLabel('Nom') is ambiguous (matches both fields).
    await page.getByLabel('Nom', { exact: true }).fill('E2E');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: /Envoyer ma demande/i }).click();
    await expect(page.getByText(/Ta demande est en attente de validation/i)).toBeVisible();

    // 2. The request landed in the DB as `pending`.
    const pending = await getAccessRequestByEmail(email);
    expect(pending?.status).toBe('pending');

    // 3. An admin logs in and approves it through the real admin UI.
    const admin = await seedAdminUser({ firstName: 'Admin' });
    await page.goto('/');
    await loginAs(page, request, admin.email, admin.password);
    await page.goto('/admin/access-requests');

    // Scope the "Accepter" click to the row carrying this exact email.
    const row = page
      .getByText(email, { exact: true })
      .locator('xpath=ancestor::*[.//button[normalize-space()="Accepter"]][1]');
    await row.getByRole('button', { name: 'Accepter' }).click();
    // The approval flips the request out of "pending" and `revalidatePath`
    // drops it from the queue — wait for the row to clear (a transient local
    // "Demande acceptée" banner races the revalidation, so assert the durable
    // outcome: the row is gone) before reading the DB.
    await expect(page.getByText(email, { exact: true })).toBeHidden({ timeout: 10_000 });

    // 4. Real DB transition: approved + a real Invitation was minted + linked.
    const approved = await getAccessRequestByEmail(email);
    expect(approved?.status).toBe('approved');
    expect(approved?.invitationId).toBeTruthy();
    expect(await countInvitationsForEmail(email)).toBeGreaterThanOrEqual(1);
  });

  test('B — a confirmed invitation lets a member onboard into an active account (real account creation)', async ({
    page,
  }) => {
    // An admin is needed only as the invitation's `invitedById` FK.
    const admin: SeededUser = await seedAdminUser({ firstName: 'Inviter' });
    const email = uniqueTestEmail('onboard');
    const { plainToken } = await seedInvitation({ email, invitedById: admin.id });

    // No such member exists yet.
    expect(await getUserByEmail(email)).toBeNull();

    // 1. The member opens the magic link and sees the onboarding form.
    await page.goto(`/onboarding/welcome?token=${plainToken}`);
    await expect(page.getByRole('heading', { name: /Bienvenue/i })).toBeVisible();

    // 2. They set their identity + password and accept the RGPD consent.
    await page.getByLabel('Prénom').fill('Nouveau');
    await page.getByLabel('Nom', { exact: true }).fill('Membre');
    await page.getByLabel('Mot de passe', { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel('Confirme le mot de passe').fill(E2E_PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Créer mon compte/i }).click();

    // 3. Auto sign-in lands them on the PROFILING INTERVIEW — data accumulation
    //    starts at the acceptance link (S2 brief), not on an empty dashboard.
    //    The member space exists either way (asserted from the DB below).
    await page.waitForURL(/\/onboarding\/interview/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Apprends à te connaître/i })).toBeVisible();

    // 4. Real DB: an active member account was created from the invitation.
    const user = await getUserByEmail(email);
    expect(user).not.toBeNull();
    expect(user?.role).toBe('member');
    expect(user?.status).toBe('active');
  });
});
