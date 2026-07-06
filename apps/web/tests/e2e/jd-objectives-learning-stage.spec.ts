/**
 * J-D — RUNTIME proof for the D4 member-facing surface: the deterministic
 * LEARNING STAGE block on `/objectifs` ("Ton stade d'apprentissage").
 *
 * D4 derives the stage ENUM from the member's onboarding `MemberProfile.
 * learningStage` and renders a fixed French label + a fixed action hint —
 * NEVER the raw AI `rationale`/`evidence`, so no AI Act art.50 banner is
 * required on this block (it is enum-derived, deterministic). This is the
 * browser gate the `/frontend-elite` standard requires: it LOADS the real
 * Next page with a real MEMBER session + real Prisma data and proves, on
 * desktop AND mobile (both Playwright projects run this file):
 *   1. the D4 block renders with its eyebrow + French label + fixed hint;
 *   2. zero console error / zero uncaught page error / no Next error overlay;
 *   3. no horizontal overflow at the tested viewport;
 *   4. the admin-only dimensions (weakSignals especially) NEVER leak onto
 *      this member surface (privacy regression guard — /objectifs is a
 *      Server Component that only reads learningStage among the 4 dims);
 *   5. (opt-in, local) the full frontend-elite runtime-audit.js passes — set
 *      FE_AUDIT_FILE to the audit script path to run the contrast/a11y/
 *      structure gate against the live page. Skipped in CI.
 *
 * Seeding is direct Prisma (never a `'server-only'` import), mirroring
 * `jc-admin-profile-runtime.spec.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const GOTO_TIMEOUT = 120_000;

// DEV-ONLY console/pageerror noise under `next dev` (no Caddy, HMR, dev overlay
// probes). Targeted so a REAL app error is still caught.
const BENIGN = [
  /ResizeObserver loop/i,
  /Hydration failed/i,
  /hmr-client/i,
  /__nextjs_original-stack-frames/i,
  /browser_dev_/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
];

const isBenign = (msg: string) => BENIGN.some((re) => re.test(msg));

// A realistic MemberProfile: learningStage drives the D4 block; the other
// fields keep the surrounding /objectifs surfaces (coaching axis, etc.)
// realistic. weakSignals is seeded to PROVE it never surfaces on /objectifs.
const LEARNING_STAGE = {
  stage: 'subjective',
  rationale: 'Il verbalise ses ressentis mais sans process encore stabilisé.',
  evidence: ['je ressens du doute au moment d’entrer'],
};
const COACHING_TONE = {
  register: 'socratique',
  rationale: 'Progresse le mieux quand il questionne ses propres décisions.',
  evidence: ['je remets tout en question avant d’agir'],
};
const WEAK_SIGNALS = [
  {
    signal: 'Tendance à augmenter la taille juste après une perte (revenge sizing latent).',
    dimensionId: 'discipline_plan_adherence',
    evidence: ['je sur-ajuste la taille après une perte'],
  },
];

// Expected deterministic copy for stage 'subjective' (mirror learning-stage.ts).
const EXPECTED_LABEL = 'Subjectif';
const EXPECTED_HINT = 'Travaille ta lecture du marché en gardant ton cadre comme garde-fou.';

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once.`,
    };
  }
  return { ok: true };
}

/** Collect console errors + uncaught page errors while `fn` runs. */
async function withErrorCapture(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error' && !isBenign(m.text())) errors.push(`console: ${m.text()}`);
  };
  const onPageError = (e: Error) => {
    const msg = e.message ?? String(e);
    if (!isBenign(msg)) errors.push(`pageerror: ${msg}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await fn();
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  return errors;
}

test.describe('J-D — /objectifs learning-stage block renders at runtime (real DB + member session)', () => {
  let member: SeededUser | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'JDStage' });

    const interview = await db.onboardingInterview.create({
      data: {
        userId: member.id,
        status: 'completed',
        completedAt: new Date('2026-05-28T10:30:00.000Z'),
        claudeModelVersion: 'claude-opus-4-8',
        instrumentVersion: 'v1',
      },
      select: { id: true },
    });

    await db.memberProfile.create({
      data: {
        userId: member.id,
        interviewId: interview.id,
        summary:
          'Trader discipliné en construction : lucide sur ses émotions, encore irrégulier sur le respect du plan.',
        highlights: [
          {
            key: 'lucidite',
            label: 'Bonne lucidité émotionnelle',
            evidence: ['je ressens du doute au moment d’entrer'],
          },
        ],
        axesPrioritaires: [
          'Respecter le plan avant chaque entrée',
          'Rituel de reprise calme après une perte',
        ],
        claudeModelVersion: 'claude-opus-4-8',
        instrumentVersion: 'v1',
        coachingTone: COACHING_TONE,
        learningStage: LEARNING_STAGE,
        weakSignals: WEAK_SIGNALS,
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('member sees the D4 learning-stage block, 0 console error, no overflow', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // `loginAs` runs CSRF + credentials on the `request` context and copies the
    // session cookie onto the page context — no page navigation needed.
    await loginAs(page, request, member.email, member.password);

    const errors = await withErrorCapture(page, async () => {
      await page.goto('/objectifs', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
      await expect(page).not.toHaveURL(/\/login(\?|$)/);
      await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

      // The D4 block: eyebrow + enum-derived French label + fixed hint.
      await expect(page.getByText('Ton stade d’apprentissage')).toBeVisible();
      await expect(page.getByRole('heading', { name: EXPECTED_LABEL, exact: true })).toBeVisible();
      await expect(page.getByText(EXPECTED_HINT, { exact: true })).toBeVisible();
    });

    // No horizontal overflow at this viewport (desktop 1440 / mobile 393).
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(
      overflow.sw,
      `horizontal overflow (${overflow.sw} > ${overflow.iw})`,
    ).toBeLessThanOrEqual(overflow.iw + 1);

    // PRIVACY — none of the admin-only dimensions leak onto /objectifs. The
    // page reads only `learningStage` among the 4 dims; weakSignals + its
    // headings must be architecturally absent from the member payload.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toContain('Signaux faibles à observer');
    expect(body).not.toContain('Axes prioritaires structurés');
    expect(body).not.toContain('revenge sizing latent');

    // Opt-in full frontend-elite audit (contrast/a11y/structure) against the
    // live page. Runs only when FE_AUDIT_FILE points at the audit script.
    const auditFile = process.env.FE_AUDIT_FILE;
    if (auditFile && existsSync(auditFile)) {
      const src = readFileSync(auditFile, 'utf8');
      const report = (await page.evaluate('(' + src + ')()')) as {
        pass: boolean;
        summary: string;
        fails: string[];
      };
      expect(report.fails, `frontend-elite audit fails: ${report.summary}`).toEqual([]);
      expect(report.pass, report.summary).toBe(true);
    }

    expect(errors, `runtime errors on /objectifs:\n${errors.join('\n')}`).toEqual([]);
  });
});
