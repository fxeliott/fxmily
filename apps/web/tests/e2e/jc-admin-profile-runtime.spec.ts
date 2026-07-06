/**
 * J-C — RUNTIME proof for the 4 deep-AI MemberProfile dimensions surfaced in
 * the admin member view (`/admin/members/[id]?tab=profile`).
 *
 * This is the browser gate the `/frontend-elite` standard requires: it does not
 * assert "it compiles", it LOADS the real Next page with a real admin session
 * and real Prisma data (a MemberProfile carrying coachingTone / learningStage /
 * axesStructured / weakSignals) and proves, on desktop AND mobile (both
 * Playwright projects run this file):
 *   1. the 4 sections render with their French labels + verbatim evidence;
 *   2. the admin-only `weakSignals` text is visible to the admin;
 *   3. exactly one AI Act art.50 banner covers the whole AI-derived block;
 *   4. zero console error / zero uncaught page error / no Next error overlay;
 *   5. no horizontal overflow at the tested viewport;
 *   6. (opt-in, local) the full frontend-elite runtime-audit.js passes — set
 *      FE_AUDIT_FILE to the audit script path to run the contrast/a11y/structure
 *      gate against the live page. Skipped in CI (the file lives under ~/.claude).
 *
 * PRIVACY atom — a second test logs in as the MEMBER and loads `/profile` to
 * prove the 4 dimensions (especially weakSignals) NEVER reach the member
 * surface. `/profile` is a Server Component that only reads summary/highlights/
 * axes_prioritaires, so the fields are architecturally absent from the member's
 * payload; this test is the durable regression guard for that invariant.
 *
 * Seeding is direct Prisma (never a `'server-only'` import), following the
 * session10 admin-journey pattern.
 */

import { existsSync, readFileSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
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

// Evidence strings are also injected as answer-corpus substrings at write time
// in the real pipeline; here we only need the columns populated for rendering.
const COACHING_TONE = {
  register: 'socratique',
  rationale: 'Le membre progresse le mieux quand on le laisse questionner ses propres décisions.',
  evidence: ['je remets tout en question avant d’agir'],
};
const LEARNING_STAGE = {
  stage: 'subjective',
  rationale: 'Il verbalise ses ressentis mais sans process encore stabilisé.',
  evidence: ['je ressens du doute au moment d’entrer'],
};
const AXES_STRUCTURED = [
  {
    axis: 'Consolider la conformité au plan personnel avant chaque prise de position',
    dimensionId: 'discipline_plan_adherence',
    priority: 5,
    evidence: ['je note 4 sur 10 en discipline'],
  },
  {
    axis: 'Ancrer un rituel de reprise calme après une perte',
    dimensionId: 'emotional_regulation',
    priority: 3,
    evidence: ['je sur-ajuste la taille après une perte'],
  },
];
const WEAK_SIGNALS = [
  {
    signal: 'Tendance à augmenter la taille juste après une perte (revenge sizing latent).',
    dimensionId: 'discipline_plan_adherence',
    evidence: ['je sur-ajuste la taille après une perte'],
  },
];

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

test.describe('J-C — admin deep-AI dimensions render at runtime (real DB + admin session)', () => {
  let admin: SeededUser | null = null;
  let member: SeededUser | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'JCAdmin' });
    member = await seedMemberUser({ firstName: 'JCTracked' });

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
          'Rituel de reprise après perte',
        ],
        claudeModelVersion: 'claude-opus-4-8',
        instrumentVersion: 'v1',
        coachingTone: COACHING_TONE,
        learningStage: LEARNING_STAGE,
        axesStructured: AXES_STRUCTURED,
        weakSignals: WEAK_SIGNALS,
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
  });

  test('admin sees the 4 dimensions with 0 console error and no overflow', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');

    // `loginAs` runs the CSRF + credentials dance on the `request` context and
    // copies the session cookie onto the page context — it needs NO page
    // navigation. Skipping a `/login` visit avoids the post-login client
    // redirect to /dashboard racing (and interrupting) the first real goto.
    await loginAs(page, request, admin.email, admin.password);

    const errors = await withErrorCapture(page, async () => {
      await page.goto(`/admin/members/${member!.id}?tab=profile`, {
        waitUntil: 'domcontentloaded',
        timeout: GOTO_TIMEOUT,
      });

      // Admin gate held.
      await expect(page).not.toHaveURL(/\/login(\?|$)/);
      await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

      // The 4 J-C sections + admin-only weak-signal text.
      await expect(page.getByText('Registre de coaching suggéré')).toBeVisible();
      // `exact: true` — Playwright getByText is case-insensitive substring by
      // default, so a bare 'Subjectif' also matches the caption "…mécanique,
      // subjectif, intuitif". Pin the enum badge exactly.
      await expect(page.getByText('Socratique', { exact: true })).toBeVisible();
      await expect(page.getByText("Stade d'apprentissage")).toBeVisible();
      await expect(page.getByText('Subjectif', { exact: true })).toBeVisible();
      await expect(page.getByText('Axes prioritaires structurés')).toBeVisible();
      await expect(page.getByText('Signaux faibles à observer')).toBeVisible();
      await expect(
        page.getByText('Tendance à augmenter la taille juste après une perte', { exact: false }),
      ).toBeVisible();

      // Exactly one AI Act art.50 banner covers the whole AI-derived block.
      await expect(page.getByRole('note')).toHaveCount(1);
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

    // Opt-in full frontend-elite audit (contrast/a11y/structure) against the
    // live page. Runs only when FE_AUDIT_FILE points at the audit script.
    const auditFile = process.env.FE_AUDIT_FILE;
    if (auditFile && existsSync(auditFile)) {
      const src = readFileSync(auditFile, 'utf8');
      // Passed as an expression string so its internal backticks survive; CDP
      // Runtime.evaluate bypasses the page CSP, and Playwright awaits the promise.
      const report = (await page.evaluate('(' + src + ')()')) as {
        pass: boolean;
        summary: string;
        fails: string[];
      };
      expect(report.fails, `frontend-elite audit fails: ${report.summary}`).toEqual([]);
      expect(report.pass, report.summary).toBe(true);
    }

    expect(errors, `runtime errors on admin profile tab:\n${errors.join('\n')}`).toEqual([]);
  });

  test('member /profile does NOT leak the 4 admin dimensions (privacy invariant)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await loginAs(page, request, member.email, member.password);

    await page.goto('/profile', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
    await expect(page).not.toHaveURL(/\/login(\?|$)/);

    // The member's own analyzed profile renders (summary block present).
    await expect(page.getByText('Synthèse', { exact: true })).toBeVisible();

    // NONE of the 4 admin-only dimensions leak into the member surface.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toContain('Registre de coaching suggéré');
    expect(body).not.toContain("Stade d'apprentissage");
    expect(body).not.toContain('Axes prioritaires structurés');
    expect(body).not.toContain('Signaux faibles à observer');
    // The weakSignal sentence must never appear on the member page.
    expect(body).not.toContain('revenge sizing latent');
  });
});
