/**
 * Réunion Trading Hub (séances) — RUNTIME proof of the J2 member surfaces,
 * exercised end-to-end against the real Postgres through the real UI on both
 * desktop (chromium) and mobile (iPhone 15):
 *
 *   A. HUB /seances — the published séances list. A `done` séance is a clickable
 *      card; a `cancelled` one is an inert (non-link) greyed card; a `scheduled`
 *      one is NEVER exposed (anti-leak invariant).
 *
 *   B. SÉANCE /seances/[date]/[slot] (done) — replay state, « L'essentiel »,
 *      « Contexte macro » (DXY apart), per-asset deep-dives, and — the Règle n°1
 *      differentiator — the price ladder renders ONLY for the asset with ≥2
 *      distinct stated prices (DXY) and self-omits for the prose-only assets.
 *
 *   C. SÉANCE (cancelled) — minimal page (no analysis sections).
 *
 *   D. SÉANCE (scheduled) — a direct URL never serves unpublished content: the
 *      route calls notFound(), so the member gets the « Page introuvable » UI
 *      and the séance's title/analysis is absent from the document. (Status is a
 *      streamed 200 + <meta robots noindex>, not a 404 — the route has a
 *      loading.tsx Suspense boundary so Next commits 200 before the throw; the
 *      anti-leak invariant is what matters and is asserted on the body.)
 *
 * Editorial invariants checked live: 0 emoji is structural; here we prove 0 IA /
 * model / version mention leaks into the member UI (posture §2 / AI Act-safe).
 *
 * Déterminisme (canon J-C3): no `networkidle`; every assertion is gated on an
 * auto-waiting `expect(locator)`. 0 console error is asserted per page. Replay*
 * rows have 0 FK to User, so this spec seeds + cleans them by its synthetic test
 * dates (2099-01-xx) independently of `cleanupTestUsers`.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let member: SeededUser | null = null;

// Synthetic far-future test dates so the rows never collide with real/demo
// séances and are trivially cleaned by date.
const DONE_DATE = '2099-01-15';
const CANCELLED_DATE = '2099-01-14';
const SCHEDULED_DATE = '2099-01-13';
const TEST_DATES = [DONE_DATE, CANCELLED_DATE, SCHEDULED_DATE];
const DONE_TITLE = 'Analyse de test — dollar et indices';

function dbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

async function cleanupTestSeances(): Promise<void> {
  await db.replaySession.deleteMany({
    where: { date: { in: TEST_DATES.map(dbDate) } },
  });
}

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

async function dismissCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(1);
}

/**
 * Collect real console errors + uncaught page errors. A tiny allowlist drops
 * dev-only noise unrelated to the séances surface (React DevTools hint, favicon
 * 404). Anything else (a hydration mismatch, a thrown render error) fails.
 */
function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const ALLOW = [/React DevTools/i, /favicon/i, /Download the React/i];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ALLOW.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return () => errors;
}

test.describe('Séances — hub + page séance (runtime)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    await cleanupTestSeances();
    member = await seedMemberUser({ firstName: 'Seances' });

    // DONE analyse — exercises the full content surface. DXY carries 2 distinct
    // prices (ladder MUST render); GBPUSD + XAU carry prose-only levels (ladder
    // MUST self-omit — Règle n°1 anti-invention).
    await db.replaySession.create({
      data: {
        date: dbDate(DONE_DATE),
        slot: 'analyse',
        status: 'done',
        title: DONE_TITLE,
        time: '12h00',
        summary: 'Le dollar marque une pause sous son plus haut, sans changer de cap.',
        keyTakeaways: [
          'Le dollar reflue sous son plus haut de 13 mois : une respiration, pas un retournement.',
          'GBPUSD à la baisse sur rejet de zone ; indices en continuation haussière.',
        ],
        contentGenerated: true,
        contentModel: 'producteur-humain',
        assets: {
          create: [
            {
              symbol: 'DXY',
              name: 'Indice dollar',
              bias: 'haussier',
              macro: true,
              position: 0,
              levels: [
                { label: 'Plus haut 13 mois', value: '101,8' },
                { label: 'Reflux actuel', value: '101,29' },
              ],
              reading: ['Fil conducteur du jour : un dollar qui souffle, reflux léger sans cap.'],
            },
            {
              symbol: 'GBPUSD',
              name: 'Livre / Dollar',
              bias: 'baissier',
              macro: false,
              position: 1,
              levels: [{ label: 'Zone clé', value: 'Golden Zone — origine vendeuse' }],
              reading: ['Scénario principal du jour, à la baisse, sur rejet de la zone.'],
            },
            {
              symbol: 'XAUUSD',
              name: 'Or',
              bias: 'neutre',
              macro: false,
              position: 2,
              levels: [{ label: 'Structure', value: 'Sortie du canal baissier' }],
              reading: ["L'or s'est découplé du dollar ; hors radar aujourd'hui."],
            },
          ],
        },
      },
    });

    await db.replaySession.create({
      data: {
        date: dbDate(CANCELLED_DATE),
        slot: 'debrief',
        status: 'cancelled',
        title: 'Débrief de test (annulé)',
        time: '20h00',
        cancelReason: 'Pas de réunion ce soir — séance non tenue.',
      },
    });

    await db.replaySession.create({
      data: {
        date: dbDate(SCHEDULED_DATE),
        slot: 'analyse',
        status: 'scheduled',
        title: 'Analyse de test (programmée)',
        time: '12h00',
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestSeances();
    await cleanupTestUsers();
    member = null;
  });

  test('A — /seances : done cliquable, annulée inerte, programmée jamais exposée', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/seances');

    // `exact: true` — the page also renders an h2 « Toutes les séances », which
    // a substring `name` filter would match too (Playwright string names match
    // case-insensitive substrings), tripping strict mode on `toBeVisible()`.
    await expect(page.getByRole('heading', { name: 'Les séances', exact: true })).toBeVisible();
    await expect(page.getByText('séances publiées')).toBeVisible();

    // DONE card → a real link to its séance page. The most-recent done séance
    // renders TWICE by design (« À la une » + « Toutes les séances »); both
    // links carry the same href, so assert the first to avoid a strict-mode
    // violation while still proving the card is a real, correctly-targeted link.
    const doneLink = page.getByRole('link', { name: new RegExp(DONE_TITLE) }).first();
    await expect(doneLink).toBeVisible();
    await expect(doneLink).toHaveAttribute('href', `/seances/${DONE_DATE}/analyse`);

    // CANCELLED card → present + greyed + INERT (carries the cancel label, not a link).
    const cancelledCard = page.locator('article[data-status="cancelled"]', {
      hasText: 'Débrief de test (annulé)',
    });
    await expect(cancelledCard).toBeVisible();
    await expect(cancelledCard.getByText('Séance annulée')).toBeVisible();
    await expect(page.getByRole('link', { name: /Débrief de test \(annulé\)/ })).toHaveCount(0);

    // SCHEDULED → never listed.
    await expect(page.getByText('Analyse de test (programmée)')).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('B — /seances/[date]/analyse : essentiel, macro DXY, échelle anti-invention', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/seances/${DONE_DATE}/analyse`);

    await expect(page.getByRole('heading', { name: DONE_TITLE })).toBeVisible();

    // No Vimeo id seeded → replay reads as unavailable (no iframe error).
    await expect(page.getByText("n'est pas disponible")).toBeVisible();

    // L'essentiel.
    await expect(page.getByRole('heading', { name: "L'essentiel" })).toBeVisible();
    await expect(page.getByText(/une respiration, pas un retournement/)).toBeVisible();

    // Contexte macro (DXY apart) + per-asset analysis.
    await expect(page.getByRole('heading', { name: 'Contexte macro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Analyse par actif' })).toBeVisible();

    // Anti-invention (Règle n°1): EXACTLY ONE price ladder — DXY (2 distinct
    // numbers). GBPUSD + XAU are prose-only → no chart fabricated.
    const ladders = page.getByRole('img', { name: /Schéma de prix/ });
    await expect(ladders).toHaveCount(1);
    await expect(page.getByRole('img', { name: /Schéma de prix.*Indice dollar/ })).toBeVisible();
    // The stated price is shown (it may appear in both the levels list and the
    // SVG label → assert at least one visible match, not strict-single).
    await expect(page.getByText('101,8', { exact: true }).first()).toBeVisible();

    // Bias overview table + the assets' bias.
    await expect(page.getByRole('heading', { name: "Vue d'ensemble des biais" })).toBeVisible();
    await expect(page.getByText('Baissier').first()).toBeVisible();

    // Editorial invariant: 0 IA / model / version mention leaks to the member.
    await expect(page.getByText(/\bIA\b|Claude|g[ée]n[ée]r[ée] par|producteur-humain/)).toHaveCount(
      0,
    );

    // Disclaimer.
    await expect(page.getByText(/risque de perte en capital/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('C — /seances/[date]/debrief (annulée) : page minimale, aucune analyse', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/seances/${CANCELLED_DATE}/debrief`);

    await expect(page.getByText('Séance annulée')).toBeVisible();
    await expect(page.getByText('Pas de réunion ce soir — séance non tenue.')).toBeVisible();

    // No analysis surfaces on a cancelled séance.
    await expect(page.getByRole('heading', { name: "L'essentiel" })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Analyse par actif' })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('D — /seances/[date]/analyse (programmée) : not-found, contenu jamais servi', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    const res = await page.goto(`/seances/${SCHEDULED_DATE}/analyse`);
    const body = (await res?.text()) ?? '';

    // INVARIANT SÉCURITÉ — une séance `scheduled` n'est JAMAIS servie : ni son
    // titre ni ses sections d'analyse n'apparaissent dans le document.
    expect(body).not.toContain('Analyse de test (programmée)');
    await expect(page.getByRole('heading', { name: /Analyse de test/ })).toHaveCount(0);

    // La route déclenche `notFound()` → l'app sert sa page « Page introuvable ».
    await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();

    // Next injecte <meta robots noindex> quand notFound() est levé en cours de
    // stream — c'est LE signal documenté du verdict 404 pour une réponse
    // streamée [vercel/next.js : 01-app/02-guides/streaming.mdx]. On l'assert
    // plutôt qu'un `status===404` : cette route a un `loading.tsx` (boundary
    // <Suspense> implicite) → la page suspend sur ses `await` (auth + requête
    // Postgres), donc Next « commit » un 200 pour démarrer le flux HTML AVANT
    // le throw et ne peut plus changer le statut. Route auth-gated → 0
    // indexation possible ; l'invariant qui compte (contenu jamais exposé) est
    // prouvé ci-dessus, le noindex est la ceinture-bretelles SEO.
    expect(body).toMatch(/<meta[^>]*\brobots\b[^>]*\bnoindex\b/i);
  });
});
