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

import { type BrowserContext, chromium, expect, test } from './fixtures';

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

  /**
   * 5ᵉ angle — LE CTA DYNAMIQUE DE FIN DE PAGE, DANS LE FUSEAU DU MEMBRE.
   *
   * Ce que le J8 (scope 4) a livré : `/guide` ne renvoie plus vers un
   * `/checkin/morning` codé en dur, il calcule le créneau qui correspond au
   * moment que vit le membre, DANS SON fuseau. `checkin-cta.test.ts` prouve la
   * règle en unitaire ; `first-run-welcome.test.tsx` prouve le rendu du même
   * objet sur l'ACCUEIL. Rien ne regardait la page qui a motivé le scope. Un
   * retour au `href="/checkin/morning"` littéral dans `guide/page.tsx` serait
   * passé au vert partout : c'est exactement le défaut d'origine, restauré sans
   * un seul test rouge.
   *
   * L'ORACLE EST INDÉPENDANT, ET C'EST TOUT L'ENJEU.
   * Appeler `checkinCta()` ici pour calculer l'attendu comparerait la fonction
   * à elle-même — une tautologie, verte même si la règle était fausse. Le test
   * n'importe donc rien du code de production : il sème un membre dans un
   * fuseau à décalage FIXE (`Etc/GMT-9` = UTC+9, sans heure d'été), puis dérive
   * l'heure locale par arithmétique nue sur `getUTCHours()`. Aucun `Intl`,
   * aucun helper de l'app. Seule la règle produit — « avant 14 h locales =
   * matin » — est réécrite ici, ce qui est le rôle d'un test.
   *
   * Les fuseaux sont loin de Paris À DESSEIN : avec `Europe/Paris`, un helper
   * qui ignorerait le fuseau du membre et lirait celui du serveur passerait. Le
   * runner CI est en UTC, l'app en Europe/Paris.
   *
   * ⚠️ TROIS FUSEAUX, ET C'EST UNE CORRECTION — UN SEUL RENDAIT CE TEST AVEUGLE
   * 14 HEURES SUR 24. Première rédaction : le seul `Etc/GMT-9`. Or la fenêtre
   * « matin » fait 14 h de large (avant 14 h locales), donc pour un membre en
   * UTC+9 le créneau attendu EST « matin » dès que l'heure UTC tombe dans
   * [15 h, 24 h) ∪ [0 h, 5 h). Sur toute cette plage, un `href="/checkin/morning"`
   * recodé en dur — le défaut même que ce test dit tuer — passait au vert. Le
   * commentaire présentait la couverture comme acquise ; elle ne l'était que
   * pendant les 10 heures restantes. Que la falsification ait réussi le jour où
   * je l'ai lancée ne prouvait donc rien sur les autres heures.
   *
   * Trois fuseaux espacés de 8 h (+9, +1, −7) ferment la fenêtre par
   * construction : leurs heures locales sont étalées sur 16 h, ce qui n'entre ni
   * dans la fenêtre « matin » (14 h) ni dans la fenêtre « soir » (10 h). Il y a
   * donc, à CHAQUE instant, au moins un membre attendu au matin et au moins un
   * au soir — vérifié exhaustivement sur les 24 heures UTC avant d'écrire ce
   * test. Deux fuseaux ne pourraient pas y suffire : 14 + 14 > 24, deux fenêtres
   * « matin » se recouvrent forcément sur au moins 4 h.
   *
   * Course d'une minute : si l'heure UTC bascule pendant le test, l'attendu
   * change au milieu. On calcule donc l'attendu AVANT et APRÈS, et on accepte
   * l'un ou l'autre — les deux sont identiques hors de cette seconde-là.
   */
  const CTA_ZONES = [
    { tz: 'Etc/GMT-9', offset: 9, slug: 'plus9' },
    { tz: 'Etc/GMT-1', offset: 1, slug: 'plus1' },
    { tz: 'Etc/GMT+7', offset: -7, slug: 'minus7' },
  ] as const;

  /**
   * Les contextes ouverts à la main sont fermés au teardown, PAS en fin de
   * boucle. La nuance compte : une assertion qui lève saute tout ce qui suit,
   * donc un `close()` en fin de corps laisserait ouvert exactement le contexte
   * du fuseau FAUTIF — celui dont on a besoin, puisque Playwright vide traces
   * et vidéos à la fermeture. Le tableau est vidé par `splice`, donc un test
   * qui n'en ouvre aucun ne paie rien.
   */
  const openContexts: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test('CTA: le lien suit le créneau du fuseau du MEMBRE, à toute heure', async ({
    browser,
    request,
  }) => {
    /** Créneau attendu, dérivé sans `Intl` ni code de production. */
    const expectedHref = (offset: number): '/checkin/morning' | '/checkin/evening' =>
      (((new Date().getUTCHours() + offset) % 24) + 24) % 24 < 14
        ? '/checkin/morning'
        : '/checkin/evening';

    const observed: string[] = [];

    for (const zone of CTA_ZONES) {
      const member = await seedMemberUser({
        email: `j8-guide-cta-${zone.slug}.member.e2e.test@fxmily.local`,
        password: `J8-GuideCta-${zone.slug}-2026!`,
        firstName: 'J8',
        lastName: 'GuideCta',
        timezone: zone.tz,
      });

      const before = expectedHref(zone.offset);

      // ⚠️ UN CONTEXTE NEUF PAR FUSEAU — ET C'EST LA CI QUI L'A EXIGÉ.
      //
      // La version précédente réutilisait la même page en se contentant de
      // `clearCookies()`. Premier run de ce test contre un BUILD DE PRODUCTION
      // en CI : le fuseau +1, attendu au soir, a reçu `/checkin/morning` —
      // c'est-à-dire la réponse du fuseau +9 traité juste avant, lui bien au
      // matin. Vert au retry, donc invisible sans lire les artefacts.
      //
      // Honnêteté sur la cause : elle n'est PAS prouvée. L'hypothèse qui colle
      // est le Router Cache client de Next, qui survit à `clearCookies()` et
      // resert un payload RSC déjà obtenu — un cache dont le comportement
      // diffère justement entre `next dev` et un build de production. Je n'ai
      // pas réussi à le reproduire en local (3 runs verts d'affilée), donc je
      // ne l'affirme pas.
      //
      // Ce qui est fait ici ne devine pas la cause : il supprime la CLASSE. Un
      // contexte neuf par fuseau, c'est zéro cookie, zéro cache mémoire, zéro
      // état partagé entre deux membres qui doivent justement voir des choses
      // différentes. Un test dont l'isolation dépend de la vitesse du runner
      // n'est pas un test.
      const context = await browser.newContext({
        // `browser.newContext()` n'hérite PAS du `use.baseURL` du config.
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
      });
      openContexts.push(context);
      const page = await context.newPage();

      await page.goto('/login');
      await loginAs(page, request, member.email, member.password);
      await page.goto('/guide');

      // DEUX sites, pas un — et c'est la découverte de ce test. `/guide` peint le
      // CTA dynamique à deux endroits : sur le pilier qui se déclare porteur
      // (`dynamicCheckinCta`, page.tsx:258) et dans la carte finale « Et
      // maintenant » (page.tsx:444). Une première rédaction attendait un seul
      // lien et rougissait : la page en montrait deux. Le compte est donc épinglé
      // à 2, et surtout les DEUX doivent porter le même créneau — un site resté
      // codé en dur garderait ce compte tout en mentant la moitié du temps.
      const cta = page
        .getByRole('main')
        .getByRole('link', { name: /Faire mon check-in du (matin|soir)/ });
      await expect(
        cta,
        `${zone.tz} : le CTA dynamique vit sur le pilier ET dans la carte « Et maintenant »`,
      ).toHaveCount(2);

      const hrefs = await cta.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('href') ?? ''),
      );
      const after = expectedHref(zone.offset);

      expect(
        new Set(hrefs).size,
        `${zone.tz} : les deux CTA divergent : ${hrefs.join(' / ')}`,
      ).toBe(1);

      const href = hrefs[0] ?? '';
      expect(
        [before, after],
        `${zone.tz} : le CTA pointe vers ${href} ; pour un membre en UTC${zone.offset >= 0 ? '+' : ''}${zone.offset} ` +
          `il est ${((((new Date().getUTCHours() + zone.offset) % 24) + 24) % 24).toString()}h locales, ` +
          `donc ${after} est attendu. Un lien figé est le défaut que le scope 4 a supprimé.`,
      ).toContain(href);

      // Le libellé suit le créneau : un href juste sous un texte faux serait un
      // demi-correctif (le membre lit le texte, pas l'URL).
      const expectedLabel = href === '/checkin/morning' ? /check-in du matin/ : /check-in du soir/;
      await expect(cta.first()).toHaveText(expectedLabel);
      await expect(cta.last()).toHaveText(expectedLabel);

      // ⚠️ ICI VIVAIT UNE ASSERTION MAL CADRÉE, ET ELLE A FINI PAR MENTIR.
      //
      // Elle exigeait que le créneau OPPOSÉ n'apparaisse NULLE PART dans
      // `<main>`. Verte au moment où je l'ai écrite, rouge quelques heures plus
      // tard — et pour une bonne raison, découverte en la mesurant : la page du
      // guide affiche aussi le bandeau de GUIDAGE QUOTIDIEN (« Maintenant :
      // Check-in du matin »), qui répond à une tout autre question. Le CTA dit
      // « quel créneau correspond au moment que tu vis » ; le guidage dit
      // « quelle est ta prochaine action non faite ». Pour un membre à 16 h
      // locales qui n'a pas fait son check-in du matin, les deux réponses
      // DIVERGENT légitimement, et le lien du matin est donc bien là.
      //
      // Ce que l'assertion voulait attraper — « un rendu qui peindrait les deux
      // liens » — est déjà couvert plus haut, et mieux : les liens de CTA sont
      // exactement 2, ils portent le même href, et cet href est celui attendu.
      // Un site resté codé en dur sur l'autre créneau y rougit. Retirer une
      // assertion redondante dont le périmètre était faux n'affaiblit rien ;
      // la garder aurait rendu ce test rouge une partie de la journée, pour un
      // comportement correct — c'est-à-dire l'aurait rendu ignorable.
      //
      // 🟠 CE QUE ÇA RÉVÈLE, ET QUI N'EST PAS UNE QUESTION DE TEST : sur le même
      // écran, le membre lit « Faire mon check-in du soir » et « Maintenant :
      // Check-in du matin ». Les deux sont défendables séparément, ensemble ils
      // se contredisent aux yeux du membre. Quelle source doit gouverner le CTA
      // du guide — l'heure, ou le plan du jour ? C'est un arbitrage produit,
      // remonté à Eliot plutôt que tranché dans un test.

      observed.push(href);
    }

    // LA GARDE QUI REND LE TEST NON AVEUGLE : les trois fuseaux ne peuvent pas
    // tous répondre la même chose (démontré ci-dessus sur les 24 heures). Si
    // c'était le cas, c'est que le rendu ne lit plus le fuseau du membre — ou
    // que quelqu'un a changé les fuseaux pour des voisins, ce qui rendrait
    // silencieusement le test incapable d'attraper un href figé.
    expect(
      new Set(observed).size,
      `les 3 fuseaux (+9 / +1 / −7) répondent tous ${observed[0]} : à aucune heure UTC ils ne ` +
        `devraient s'accorder. Soit le rendu ignore le fuseau du membre, soit les fuseaux de ` +
        `CTA_ZONES ont été rapprochés et le test ne prouve plus rien.`,
    ).toBe(2);
  });
});
