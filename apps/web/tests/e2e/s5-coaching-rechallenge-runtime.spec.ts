/**
 * S5 re-challenge — preuve RUNTIME des deux correctifs livrés après le ship initial,
 * exercés de bout en bout contre le vrai Postgres à travers l'UI réelle :
 *
 *   A. §32-C — LE MOTEUR EXPLOITE LE PROFIL S2. Le membre a des `axesPrioritaires`
 *      d'onboarding au VRAI format produit par le pipeline (phrases action-concrète
 *      ≤200 chars, citations [N], concepts Douglas — PAS des mots-clés courts), dont
 *      une mappe l'axe `discipline`. Une alerte `forgot_no_reason_repeat` (axe
 *      discipline) domine sa carte mentale → l'insight de /progression porte la trace
 *      d'alignement CURÉE « En lien avec une priorité que tu t'es fixée » (jamais le
 *      texte libre brut : §50/§2 préservés). Avant le correctif, le profil n'était
 *      JAMAIS lu — et un seed « Tenir mon plan » taillé pour les keywords aurait
 *      masqué que le seam était inerte sur le vrai format (2e re-challenge S5).
 *
 *   B. a11y §31.2 / WCAG 1.4.3 — CONTRASTE DES CHIPS EN LIGHT. Le chip de tonalité
 *      de l'insight portait `text-[var(--warn)]` SANS `data-slot="pill"`, échappant
 *      au correctif S18.1 (`.light [data-slot='pill'][data-tone]` → `-hi`). On force
 *      le thème light et on PROUVE au navigateur que la couleur calculée du chip est
 *      bien `--warn-hi` (corrigée, AA) et NON `--warn` (la base sous 4.5:1).
 *
 * Déterminisme (canon J-C3) : pas de `networkidle` ; assertions auto-attendues.
 * Skip propre si Chromium n'est pas installé.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let member: SeededUser | null = null;

/** Trace d'alignement attendue — apostrophe typographique U+2019 (identique engine.ts). */
const ALIGNMENT_TRACE = 'En lien avec une priorité que tu t’es fixée';

/**
 * Axes prioritaires au VRAI format du pipeline d'onboarding (action-concrète, ≤200
 * chars, citation [N], lexique Douglas) — pas des mots-clés courts. Le 1er mappe
 * `discipline` (rigueur/exécution/plan/process/checklist), le 2e mappe `ego`
 * (détachement/acceptation). C'est ce format que `classifyPriorityAxes` doit savoir
 * lire en prod ; un seed mots-clés l'aurait faussement validé. Ces chaînes BRUTES ne
 * doivent JAMAIS être rendues à l'écran (§50/§2) — la trace affichée est figée.
 */
const RAW_AXIS_DISCIPLINE =
  "Renforcer la rigueur d'exécution du plan — suivre le process défini et la checklist avant d'agir plutôt que d'improviser sous l'impulsion [12].";
const RAW_AXIS_EGO =
  "Travailler le détachement du résultat — accepter qu'un trade exécuté à la lettre reste un bon process, même perdant (5 vérités #3, cf. [9]).";

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

test.describe('S5 re-challenge — profil S2 exploité + contraste chips light', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S5Rechallenge' });

    // §32-C — profil S2 : axes prioritaires d'onboarding au VRAI format du pipeline.
    // RAW_AXIS_DISCIPLINE → discipline ; RAW_AXIS_EGO → ego. Le moteur DOIT les lire
    // (chaîne FK : OnboardingInterview → MemberProfile) et n'en surfacer aucun brut.
    const interview = await db.onboardingInterview.create({
      data: {
        userId: member.id,
        status: 'completed',
        completedAt: new Date(),
        instrumentVersion: 'v1',
      },
      select: { id: true },
    });
    await db.memberProfile.create({
      data: {
        userId: member.id,
        interviewId: interview.id,
        summary: 'Profil de test runtime (re-challenge S5).',
        highlights: [],
        axesPrioritaires: [RAW_AXIS_DISCIPLINE, RAW_AXIS_EGO],
        claudeModelVersion: 'claude-opus-4-8',
        instrumentVersion: 'v1',
        analyzedAt: new Date(),
      },
    });

    // Une alerte de répétition discipline → l'insight dominant porte sur `discipline`,
    // qui est précisément un axe prioritaire du membre → trace d'alignement attendue.
    await db.alert.create({
      data: {
        memberId: member.id,
        triggerType: 'forgot_no_reason_repeat',
        repeatCount: 3,
        threshold: 3,
        status: 'delivered',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('A — /progression : l’insight cite la priorité d’onboarding du membre (§32-C)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/progression');

    // L'insight se monte via Suspense — on attend son ancre.
    await expect(page.getByRole('heading', { name: 'Ton coaching du moment' })).toBeVisible();

    // §32-C — la trace d'alignement prouve que le profil S2 a bien été LU et exploité
    // (l'axe dominant `discipline` ∈ priorités du membre). Avant le fix : absente.
    await expect(page.getByText(ALIGNMENT_TRACE)).toBeVisible();

    // §50/§2 — la trace est la copie FIGÉE, jamais le texte libre brut AI-dérivé de
    // l'axe. On prouve que NI le contenu discipline NI le contenu ego ne fuite à
    // l'écran, malgré leur présence dans le profil exploité par le moteur.
    await expect(page.getByText('Renforcer la rigueur')).toHaveCount(0);
    await expect(page.getByText('détachement du résultat')).toHaveCount(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('B — light : le chip de l’insight calcule --warn-hi (WCAG 1.4.3, S18.1)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/progression');
    await expect(page.getByRole('heading', { name: 'Ton coaching du moment' })).toBeVisible();

    const result = await page.evaluate(() => {
      // Force le thème light (CSS déjà chargé : la classe active l'override S18.1).
      const html = document.documentElement;
      html.classList.remove('dark');
      html.classList.add('light');

      const chip = document.querySelector<HTMLElement>(
        '[data-slot="coaching-insight-card"] [data-slot="pill"]',
      );
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = 'var(--warn-hi)';
      const hi = getComputedStyle(probe).color;
      probe.style.color = 'var(--warn)';
      const base = getComputedStyle(probe).color;
      probe.remove();

      return {
        tone: chip?.getAttribute('data-tone') ?? null,
        chipColor: chip ? getComputedStyle(chip).color : null,
        hi,
        base,
      };
    });

    expect(result.tone).toBe('warn');
    // Le correctif s'applique : le chip calcule la variante -hi (AA), pas la base.
    expect(result.chipColor).toBe(result.hi);
    expect(result.chipColor).not.toBe(result.base);
  });
});
