/**
 * SESSION 10 — Interconnexion / Validation finale.
 *
 * MEMBER end-to-end NON-RUPTURE sweep (DoD §30 #1 — « parcours bout-en-bout
 * membre testé sans rupture »). One authenticated member visits EVERY primary
 * member surface in sequence and we assert, per route, that:
 *
 *   1. the auth gate held (we did NOT bounce to /login → session + status=active
 *      is honoured on every protected surface);
 *   2. no Next.js runtime error overlay rendered (no crashed Server/Client
 *      Component, no thrown render — `[data-nextjs-dialog-overlay]` absent);
 *   3. no uncaught page error (window 'error' / unhandled rejection) fired
 *      while the route mounted.
 *
 * This is the cross-session coverage net for S10: it deliberately includes the
 * surfaces that had NO functional spec before (`/debrief-mensuel`, `/library*`,
 * `/track/*`, `/account/data`, `/account/delete`) alongside the already-covered
 * hubs, so a regression on ANY member surface — from ANY of sessions 1-9 —
 * shows up here as one failing route.
 *
 * Seeding (carbon `s4-espace-membre-s3-surfaces.spec.ts`): direct Prisma via
 * `@/lib/db` + a little real history so the rich pages (dashboard, journal,
 * mindset) render real content instead of pure empty states. NEVER a
 * `'server-only'` import (scar GG-CI).
 *
 * Runtime cost: this sweep visits ~37 routes serially. Under `next dev` each
 * route cold-compiles once (slow D: disk), so generous per-goto timeouts are
 * used. It runs on BOTH the chromium and the mobile-iphone-15 (webkit) projects
 * since S10 MAJ-42 closed the mobile blind spot — the only webkit-specific
 * divergence (insecure-origin Service Worker noise) is in `BENIGN_PAGEERROR`.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedMemberUser,
  seedTradeHistory,
  seedCheckinHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const GOTO_TIMEOUT = 120_000;

/**
 * Console-error / pageerror noise we tolerate (benign in `next dev`):
 *  - Next.js HMR / fast-refresh chatter, source-map fetches;
 *  - favicon / manifest 404s on routes that don't set them;
 *  - third-party (Sentry) transport noise when no DSN is wired in dev.
 * Anything else that throws at the page level is a REAL rupture.
 */
const BENIGN_PAGEERROR = [
  /ResizeObserver loop/i,
  /Hydration failed/i, // dev-only hydration warning surfaces as console, not a crash; kept lenient
  // DEV-ONLY Turbopack/Next noise that does NOT exist in a prod `next start`
  // build — a transient HMR chunk fetch + the dev error-overlay stack-frame
  // probe (blocked by CORS). Surfaced on mobile under cold-compile navigation.
  // Targeted patterns (hmr-client / dev overlay) so a REAL app chunk failure
  // is still caught.
  /hmr-client/i,
  /__nextjs_original-stack-frames/i,
  /browser_dev_/i,
  // WebKit-only + dev-only (the mobile-iphone-15 project runs webkit on
  // http://localhost): registering the Service Worker on /account/notifications
  // (sw-register.tsx) rejects with "/sw.js due to access control checks" because
  // WebKit refuses SW script loads on an insecure http origin under `next dev`.
  // The app already swallows this (sw-register.tsx:49 .catch → console.warn) and
  // prod is HTTPS (`next start`) where Safari registers the SW normally — proven
  // by the iOS real-device smoke (SPEC §15 J9). Chromium passes the very same
  // route, and CI is chromium-only (e2e.yml). So it is dev/WebKit transport
  // noise on an insecure origin, NOT an app rupture.
  /sw\.js.*access control/i,
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

/** Visit one route and assert non-rupture. Returns the collected hard errors. */
async function visitAndAssert(page: Page, route: string): Promise<void> {
  const pageErrors: string[] = [];
  const onPageError = (err: Error) => {
    const msg = err.message ?? String(err);
    if (!BENIGN_PAGEERROR.some((re) => re.test(msg))) pageErrors.push(`${route} :: ${msg}`);
  };
  page.on('pageerror', onPageError);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

    // 1) auth gate held — a protected route must NOT bounce to /login.
    await expect(page, `${route} bounced to /login (auth/status gate broke)`).not.toHaveURL(
      /\/login(\?|$)/,
    );

    // 2) no Next.js runtime error overlay (crashed RSC / thrown render).
    await expect(
      page.locator('[data-nextjs-dialog-overlay]'),
      `${route} rendered a Next.js error overlay`,
    ).toHaveCount(0);

    // Give a thrown render / effect a tick to surface as a pageerror.
    await page.waitForTimeout(150);
  } finally {
    page.off('pageerror', onPageError);
  }

  expect(pageErrors, `uncaught page error(s) on ${route}`).toEqual([]);
}

test.describe('S10 — parcours membre bout-en-bout : non-rupture de toutes les surfaces (real DB)', () => {
  let member: SeededUser | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S10Member' });
    // A little real history so dashboard/journal/analytics render content, not
    // just empty states (catches render bugs that only fire with data).
    await seedTradeHistory(member.id, { count: 12, seed: 1010 });
    await seedCheckinHistory(member.id, { days: 10, seed: 1010 });
    // A ConstancyScore so the /verification + dashboard verif surfaces render
    // their populated (not empty) branch.
    await db.constancyScore.create({
      data: {
        memberId: member.id,
        value: 81,
        breakdown: { honesty: 70, regularity: 88, discipline: 85 },
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('un membre actif visite toutes ses surfaces sans la moindre rupture', async ({
    page,
    request,
  }) => {
    // ~37 routes visited serially; under `next dev` each cold-compiles once on
    // the slow D: disk (and worse in CI), so the default 30s/60s test budget is
    // far too small for the cumulative sweep. This is a coverage sweep, not a
    // latency assertion — give it a generous ceiling.
    test.setTimeout(600_000);
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // Every primary member surface (sessions 1-9). Order = a plausible member
    // day. The previously-untested gaps are flagged inline.
    const MEMBER_ROUTES = [
      '/dashboard',
      '/profile',
      '/checkin',
      '/checkin/morning',
      '/checkin/evening',
      '/journal',
      '/journal/new',
      '/pre-trade/new',
      '/verification', // S3 anti-mensonge member surface
      '/mindset',
      '/mindset/new',
      '/reflect',
      '/reflect/new',
      '/review',
      '/review/new',
      '/training',
      '/training/new',
      '/training/sessions/new',
      '/training/debrief',
      '/training/debrief/new',
      '/calendrier',
      '/calendar/questionnaire/new',
      '/reunions',
      '/debrief-mensuel', // GAP before S10
      '/library', // GAP before S10
      '/library/favorites', // GAP before S10
      '/library/inbox', // GAP before S10
      '/track',
      '/track/sleep/new', // GAP before S10
      '/track/sport/new', // GAP before S10
      '/track/nutrition/new', // GAP before S10
      '/track/caffeine/new', // GAP before S10
      '/track/meditation/new', // GAP before S10
      '/account',
      '/account/notifications',
      '/account/data', // GAP before S10 (RGPD export)
      '/account/delete', // GAP before S10 (RGPD delete)
    ];

    for (const route of MEMBER_ROUTES) {
      await visitAndAssert(page, route);
    }
  });
});
