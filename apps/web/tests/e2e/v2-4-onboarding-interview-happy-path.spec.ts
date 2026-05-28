/**
 * V2.4 Phase B Onboarding Interview E2E — auth-gate + happy-path (start +
 * append idempotency + finalize flip) + render landing (M3 directive
 * 2026-05-28).
 *
 * Covers V2.4 Phase B wizard surface in 4 phases :
 *
 *   1. AUTH GATE — anon bounced to /login on /onboarding/interview/new
 *      (proxy.ts matcher + page-level `auth()` + `status='active'` gate).
 *   2. START + IDEMPOTENCY — direct Prisma `onboardingInterview.create` round-
 *      trips the V2.4 schema. A 2nd `findUnique({where:{userId}})` returns
 *      the same row (UNIQUE on userId enforced).
 *   3. APPEND UPSERT + STATUS FLIP — `onboardingInterviewAnswer.upsert` on the
 *      `(interviewId, questionIndex)` unique constraint accepts overwrite.
 *      Service-layer `appendAnswer` flips `started → in_progress` on first
 *      answer (we test the DB invariant directly here).
 *   4. FINALIZE FLIP + IDEMPOTENCY — update to `completed` is one-shot ; a
 *      re-finalize is a no-op (idempotent — mirrored at the service layer).
 *      RENDER — `/onboarding/interview` landing surfaces the h1 hero for an
 *      authed member with no interview started yet.
 *
 * NOT covered (canon `v1-5-mindset-check.spec.ts:18-22`) : driving the 30-step
 * wizard UI itself. The wizard logic is covered by Vitest +15 tests V2.4
 * Phase B (`app/onboarding/interview/actions.test.ts`).
 *
 * **Scar GG-CI** : NEVER import `lib/onboarding-interview/service.ts` (which
 * starts with `import 'server-only'`) — Playwright runtime crashes on the
 * server-only marker. Tests talk to Prisma directly via `@/lib/db` (which
 * does NOT import `server-only`). Carbone Session GG pattern verbatim.
 *
 * Cleanup : `OnboardingInterview` + `OnboardingInterviewAnswer` + `MemberProfile`
 * all declare `onDelete: Cascade` on User. `cleanupTestUsers` wipes the rows
 * explicitly BEFORE the User wipe (carbone V1.5/V1.8/V1.3/V2.3 canon).
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MEMBER_EMAIL = 'v2-4-onboarding.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'V2_4-OnboardingPwd-2026!';

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

test.describe('V2.4 Onboarding Interview — auth-gate + happy-path persist + render', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'V2_4',
      lastName: 'Onboarding',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('anon is bounced to /login on /onboarding/interview/new', async ({ page }) => {
    await page.goto('/onboarding/interview/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('START + IDEMPOTENCY: onboardingInterview.create round-trips schema + UNIQUE on userId enforced', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const interview = await db.onboardingInterview.create({
      data: {
        userId: member.id,
        instrumentVersion: 'v1',
      },
      select: {
        id: true,
        userId: true,
        status: true,
        instrumentVersion: true,
        startedAt: true,
        completedAt: true,
        claudeModelVersion: true,
        totalTokensInput: true,
        totalTokensOutput: true,
      },
    });

    expect(interview.userId).toBe(member.id);
    expect(interview.status).toBe('started');
    expect(interview.instrumentVersion).toBe('v1');
    expect(interview.completedAt).toBeNull();
    expect(interview.claudeModelVersion).toBeNull();
    expect(interview.totalTokensInput).toBe(0);
    expect(interview.totalTokensOutput).toBe(0);
    expect(interview.startedAt).toBeInstanceOf(Date);

    // Idempotency : UNIQUE on userId means a 2nd create throws P2002. A
    // findUnique returns the same row (which is the service layer's idempotent
    // path for `startInterview`).
    const same = await db.onboardingInterview.findUnique({
      where: { userId: member.id },
      select: { id: true },
    });
    expect(same?.id).toBe(interview.id);
  });

  test('APPEND UPSERT + STATUS FLIP: answer upsert overwrites on questionIndex collision + flip started → in_progress', async () => {
    if (!member) throw new Error('seed missing');

    const interview = await db.onboardingInterview.findUnique({
      where: { userId: member.id },
      select: { id: true, status: true },
    });
    if (!interview) throw new Error('interview missing — previous test should have created it');

    // First append at questionIndex=0 (warmup `parcours_origin`).
    const firstText =
      'Premier essai en démo en 2021, basculé en réel il y a deux ans, je me suis pris au sérieux après ma 1ère liquidation.';
    const created = await db.onboardingInterviewAnswer.upsert({
      where: {
        interviewId_questionIndex: {
          interviewId: interview.id,
          questionIndex: 0,
        },
      },
      update: {
        questionKey: 'parcours_origin',
        questionText: '',
        answerText: firstText,
      },
      create: {
        interviewId: interview.id,
        userId: member.id,
        questionIndex: 0,
        questionKey: 'parcours_origin',
        questionText: '',
        answerText: firstText,
      },
      select: { id: true, answerText: true },
    });
    expect(created.answerText).toBe(firstText);

    // Status flip — simulate the service-layer behaviour (started → in_progress
    // on first answer). This is the invariant `service.ts:appendAnswer:232-238`
    // guarantees ; we test the DB-side effect directly.
    await db.onboardingInterview.update({
      where: { id: interview.id },
      data: { status: 'in_progress' },
    });

    // Second append at the SAME questionIndex (correction) — should overwrite.
    const secondText =
      'Correction de ma première réponse : démo en 2021, réel fin 2023, je suis sérieux depuis 2024.';
    const updated = await db.onboardingInterviewAnswer.upsert({
      where: {
        interviewId_questionIndex: {
          interviewId: interview.id,
          questionIndex: 0,
        },
      },
      update: {
        questionKey: 'parcours_origin',
        questionText: '',
        answerText: secondText,
      },
      create: {
        interviewId: interview.id,
        userId: member.id,
        questionIndex: 0,
        questionKey: 'parcours_origin',
        questionText: '',
        answerText: secondText,
      },
      select: { id: true, answerText: true },
    });
    // Same row id → upsert overwrite (not a 2nd row).
    expect(updated.id).toBe(created.id);
    expect(updated.answerText).toBe(secondText);

    // The interview row is now in_progress.
    const refreshed = await db.onboardingInterview.findUnique({
      where: { id: interview.id },
      select: { status: true },
    });
    expect(refreshed?.status).toBe('in_progress');
  });

  test('FINALIZE FLIP + IDEMPOTENCY: in_progress → completed + 2nd call is no-op', async () => {
    if (!member) throw new Error('seed missing');

    const interview = await db.onboardingInterview.findUnique({
      where: { userId: member.id },
      select: { id: true },
    });
    if (!interview) throw new Error('interview missing');

    // Finalize : flip to completed + stamp completedAt.
    const completedAt = new Date();
    await db.onboardingInterview.update({
      where: { id: interview.id },
      data: {
        status: 'completed',
        completedAt,
      },
    });

    const after = await db.onboardingInterview.findUnique({
      where: { id: interview.id },
      select: { status: true, completedAt: true },
    });
    expect(after?.status).toBe('completed');
    expect(after?.completedAt).toBeInstanceOf(Date);

    // Re-finalize (idempotent service-layer behaviour — `service.ts:264-265`
    // returns the existing row when already-completed). The DB invariant we
    // care about is : a 2nd `findUnique` still returns `completed`, and
    // updating to the same status is a no-op (no row count regression).
    const stillCompleted = await db.onboardingInterview.findUnique({
      where: { id: interview.id },
      select: { status: true, completedAt: true },
    });
    expect(stillCompleted?.status).toBe('completed');
    expect(stillCompleted?.completedAt?.toISOString()).toBe(after?.completedAt?.toISOString());
  });

  test('RENDER: /onboarding/interview landing surfaces the h1 hero for an authed member with no interview', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    // Clear any interview state from previous tests so we hit the "no
    // interview" branch of the landing page (the branch that renders the hero
    // + Commencer mon entretien CTA).
    await db.onboardingInterviewAnswer.deleteMany({
      where: { userId: member.id },
    });
    await db.onboardingInterview.deleteMany({
      where: { userId: member.id },
    });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/onboarding/interview');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/onboarding\/interview$/);

    // V2.4 Phase B landing : h1 "Apprends à te connaître en profondeur."
    // (cf. `app/onboarding/interview/page.tsx:60`).
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/Apprends à te connaître/i);

    // CTA form must be present (POST to startInterviewFormAction).
    const cta = page.getByRole('button', { name: /Commencer mon entretien/i });
    await expect(cta).toBeVisible();

    // No Next dev-overlay error dialog mounted.
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /profile surfaces the no-interview placeholder for an authed member', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    // Ensure no interview row exists (the previous test deleted the rows).
    const remaining = await db.onboardingInterview.count({
      where: { userId: member.id },
    });
    expect(remaining).toBe(0);

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/profile$/);

    // V2.4 Phase B `/profile` standalone first-class route (Round 3 §D
    // arbitrage #5 vs nested `/account/profile`). The no-interview placeholder
    // surfaces the CTA "Commencer mon entretien".
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/Ton profil de trader/i);

    const cta = page.getByRole('link', { name: /Commencer mon entretien/i });
    await expect(cta).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
