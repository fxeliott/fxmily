/**
 * J8 scope 2 — le Guide est la SSOT : garde du RENDU, pas seulement du catalogue.
 *
 * POURQUOI CE SPEC EXISTE.
 * `src/app/guide/guide-catalog.test.ts` (15 tests) verrouille le CATALOGUE :
 * chaque route membre réelle a une entrée dans `GUIDE_CATALOG`. Il ne regarde
 * jamais la PAGE. Un `.slice(0, 5)` posé sur l'itération de rendu de
 * `src/app/guide/page.tsx` ferait disparaître des groupes entiers du sommaire —
 * le Guide cesserait d'être la source de vérité unique — et les 15 tests du
 * catalogue resteraient VERTS. Le jalon serait faussement « fait ».
 *
 * Ce spec ferme ce trou : il compte ce qui est RÉELLEMENT peint dans le
 * navigateur et le compare à la taille de `GUIDE_CATALOG`.
 *
 * POURQUOI UN E2E ET PAS UN TEST DE RENDU VITEST.
 * `/guide` est un Server Component `async` qui `await auth()` puis lit le
 * fuseau du membre ; aucun test de rendu de page (`@/app/**\/page`) n'existe
 * dans ce repo — le monter sous Vitest demanderait de mocker `@/auth`,
 * `next/navigation` et de rendre un composant async (non supporté par RTL /
 * `react-dom/server` hors RSC). Un e2e garde le rendu réel, pipeline complète,
 * sans usine à gaz.
 *
 * POURQUOI AUCUN `data-testid` N'A ÉTÉ AJOUTÉ.
 * La section du sommaire porte déjà `aria-label="Toutes tes surfaces"`
 * (`page.tsx`), donc un `role="region"` nommé et stable. Le périmètre est
 * indispensable : plusieurs hrefs du catalogue (`/mindset`, `/progression`,
 * `/reunions`, `/profile`, …) apparaissent AUSSI en CTA de pilier ailleurs sur
 * la page — un simple « le lien existe quelque part » passerait au vert malgré
 * un sommaire tronqué. On compte donc DANS la région, et seulement là.
 *
 * CE QUI EST GARDÉ (3 angles, tous rouges sur un `.slice`) :
 *   1. le nombre de GROUPES rendus == le nombre de groupes distincts du catalogue ;
 *   2. le nombre de LIENS rendus dans la région == `GUIDE_CATALOG.length` ;
 *   3. CHAQUE `href` du catalogue est présent dans la région (attrape un rendu
 *      qui garderait le bon compte mais changerait la composition).
 *
 * Scar GG-CI : `guide-catalog.ts` est un module PUR (aucun `import
 * 'server-only'`, il ne tire que `@/components/nav/nav-items`) — il est donc
 * importable directement ici, pas de réplique inline à maintenir.
 *
 * Canon e2e du repo : pas de `networkidle` contre le dev server (le socket HMR
 * Turbopack ne settle jamais) — `goto` + `toBeVisible` (auto-wait).
 *
 * Skipping policy (carbone J9 visual) : skip explicite si le binaire Chromium
 * n'est pas installé, plutôt que de crasher.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { GUIDE_CATALOG, guideEntryIcon } from '@/app/guide/guide-catalog';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MEMBER_EMAIL = 'j8-guide-render.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'J8-GuideRenderPwd-2026!';

/** Nom accessible de la section « sommaire » — `aria-label` de `guide/page.tsx`. */
const SURFACES_REGION = 'Toutes tes surfaces';

/** Groupes distincts, dans l'ordre d'insertion — miroir exact du regroupement de la page. */
const EXPECTED_GROUPS = [...new Set(GUIDE_CATALOG.map((entry) => entry.group))];

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

test.describe('J8 scope 2 — /guide : le rendu couvre tout GUIDE_CATALOG', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'J8',
      lastName: 'GuideRender',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('anon is bounced to /login on /guide', async ({ page }) => {
    await page.goto('/guide');
    await expect(page).toHaveURL(/\/login/);
  });

  test('COVERAGE: every catalog group AND every catalog entry is rendered', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // Garde-fou de la garde elle-même : un catalogue vide rendrait les
    // assertions ci-dessous trivialement vraies.
    expect(GUIDE_CATALOG.length).toBeGreaterThan(0);
    expect(EXPECTED_GROUPS.length).toBeGreaterThan(0);

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/guide');
    await expect(page).toHaveURL(/\/guide/);

    const surfaces = page.getByRole('region', { name: SURFACES_REGION });
    await expect(surfaces).toBeVisible();

    // 1. GROUPES — un `<h3>` par groupe, dans l'ordre pédagogique du catalogue.
    const groupHeadings = surfaces.getByRole('heading', { level: 3 });
    await expect(groupHeadings).toHaveCount(EXPECTED_GROUPS.length);
    await expect(groupHeadings).toHaveText(EXPECTED_GROUPS);

    // 2. LIENS — un lien par entrée, ni plus ni moins. C'est CETTE assertion
    //    qui rougit sur un `.slice()` posé sur l'itération de rendu.
    const entryLinks = surfaces.getByRole('link');
    await expect(entryLinks).toHaveCount(GUIDE_CATALOG.length);

    // 3. COMPOSITION — chaque href du catalogue est bien celui-là qui est peint
    //    (un rendu au bon compte mais à la mauvaise composition rougit ici).
    const renderedHrefs = await entryLinks.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? ''),
    );
    expect([...renderedHrefs].sort()).toEqual([...GUIDE_CATALOG.map((e) => e.href)].sort());

    // Aucun overlay d'erreur Next (le rendu a réellement abouti).
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  /**
   * 4ᵉ angle — le REPÈRE VISUEL, à la largeur qui compte.
   *
   * `guide-catalog.test.ts` prouve que chaque entrée RÉSOUT une icône ; il ne
   * prouve pas qu'elle est PEINTE, ni que c'est bien le glyphe de la nav. Un
   * rendu qui oublierait le badge, ou qui piocherait une icône « qui ressemble »,
   * laisserait tout le reste au vert.
   *
   * L'assertion s'appuie sur la classe que lucide-react pose lui-même sur son
   * `<svg>` (`lucide-layout-dashboard` pour `LayoutDashboard`) — même point
   * d'accroche que `first-run-welcome.test.tsx`. C'est donc l'identité du
   * composant qui est vérifiée, pas une approximation de forme.
   *
   * Le tout à 375 px (iPhone SE, la largeur prioritaire du repo) : la carte
   * gagne un badge de 28 px sur la ligne du titre, c'est exactement là qu'un
   * débordement horizontal apparaîtrait.
   */
  test('VISUAL: chaque carte peint le glyphe de la nav, sans débordement à 375 px', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/guide');

    const surfaces = page.getByRole('region', { name: SURFACES_REGION });
    await expect(surfaces).toBeVisible();

    // Un glyphe par entrée, et c'est CELUI de la nav.
    for (const entry of GUIDE_CATALOG) {
      const icon = guideEntryIcon(entry) as { displayName?: string } | null;
      const displayName = icon?.displayName;
      expect(displayName, `lucide displayName for ${entry.href}`).toBeTruthy();

      const lucideClass = `lucide-${displayName!
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;

      await expect(
        surfaces.locator(`a[href="${entry.href}"] svg.${lucideClass}`),
        `${entry.href} doit peindre le glyphe ${displayName}`,
      ).toHaveCount(1);
    }

    // La VIGNETTE de chaque entrée charge VRAIMENT (J8 scope 2, « 1 capture »).
    //
    // Pourquoi `naturalWidth` et pas la présence du `<img>` : une balise dont la
    // source renvoie 404 — ou, ici, la PAGE DE LOGIN — existe dans le DOM,
    // occupe sa place, et ne montre rien. Le piège est concret sur ce dépôt :
    // le matcher du proxy d'auth (`src/proxy.ts`) intercepte tout sauf une
    // liste blanche, `/guide-shots/*` n'y figure pas, et une requête SANS
    // session reçoit du HTML à la place du WebP (vérifié en production :
    // `content-type: text/html`, 39 ko). Ce test tourne AVEC session, donc il
    // prouve exactement le cas du membre — et rougirait si quelqu'un durcissait
    // le proxy au point de couper aussi les requêtes authentifiées.
    const shots = surfaces.locator('img');
    await expect(shots).toHaveCount(GUIDE_CATALOG.length);

    // Les vignettes sont en chargement PARESSEUX (voulu : 24 images sur une
    // page). Tant qu'une carte n'est jamais entrée dans le viewport, son
    // `naturalWidth` vaut légitimement 0 — ce n'est pas une image cassée, c'est
    // une image pas encore demandée. Il faut donc parcourir la page comme le
    // ferait un membre AVANT de conclure. (Première version de ce test : elle
    // ne scrollait pas et accusait 24 images saines.)
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });

    await expect
      .poll(
        async () =>
          shots.evaluateAll((nodes) =>
            nodes
              .map((n) => n as HTMLImageElement)
              .filter((img) => img.naturalWidth === 0)
              .map((img) => img.currentSrc || img.src),
          ),
        { timeout: 20_000, message: 'vignettes du sommaire qui ne chargent pas' },
      )
      .toEqual([]);

    // Zéro scroll horizontal à 375 px (porte « 0 débordement » du contrat frontend).
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `débordement horizontal à 375 px : ${overflow.scrollWidth} > ${overflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.clientWidth);

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
    expect(consoleErrors, `erreurs console : ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
