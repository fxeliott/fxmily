/**
 * LE CORRECTIF D'HYDRATATION N'A PAS TUÉ L'ANIMATION — preuve comportementale.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le 2026-07-30, dix composants ont été corrigés (commit `99079bd5`) : leur état
 * d'entrée ne se calcule plus depuis `prefers-reduced-motion`, parce que le
 * serveur ne connaît pas cette préférence et sérialisait donc un HTML que le
 * client contredisait. Le remède rend l'état FINAL des deux côtés et n'arme
 * l'entrée qu'après hydratation (`useAfterHydration`), via des keyframes dans
 * `animate`.
 *
 * Ce remède a un mode d'échec silencieux, et c'est LUI que ce fichier attrape :
 * si `armed` ne repassait jamais à `true`, toutes les surfaces deviendraient
 * vertes — plus aucun mismatch, puisque plus aucune animation — et le produit
 * perdrait ses entrées sans qu'aucun test ne s'en aperçoive. « Zéro erreur
 * d'hydratation » n'est donc PAS une preuve suffisante : il faut prouver les
 * deux directions.
 *
 *   · mouvement accepté  → l'attribut animé DOIT passer par une valeur
 *                          intermédiaire (l'animation joue réellement) ;
 *   · mouvement réduit   → l'attribut NE DOIT JAMAIS quitter sa valeur finale
 *                          (aucune animation, et surtout pas d'état d'entrée
 *                          figé qui laisserait le trait invisible).
 *
 * POURQUOI UN MutationObserver POSÉ AVANT LE CHARGEMENT
 * ----------------------------------------------------
 * Échantillonner après coup est une course perdue d'avance : en build de
 * production l'hydratation peut finir avant le premier `evaluate`, et on
 * conclurait « pas d'animation » sur une animation déjà terminée. L'observateur
 * est donc installé par `addInitScript`, donc AVANT le premier octet de
 * document : il voit chaque écriture d'attribut depuis l'origine, sans timing.
 *
 * Cible : le `DrawnRule` de `/mindset` (`components/dashboard/drawn-rule.tsx`).
 * Framer y anime `pathLength`, qu'il sérialise en `stroke-dasharray` /
 * `stroke-dashoffset` — des ATTRIBUTS, donc exactement la classe de valeurs qui
 * cassait l'hydratation. Le trait est décoratif : le tester ne dépend d'aucune
 * donnée membre, seulement de la session.
 */
import { expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

// ⚠️ Le suffixe `.e2e.test@fxmily.local` n'est pas cosmétique : `cleanupTestUsers`
// (src/test/db-helpers.ts:143) ne supprime QUE les adresses qui le contiennent.
// Une adresse hors convention survit à la base, et le deuxième passage du test
// meurt sur « Unique constraint failed on the fields: (email) » — mesuré.
const MEMBER_EMAIL = 'reduced-motion.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'Reduced-Motion-Behaviour-1!';

/** Le `<svg>` de `DrawnRule` : viewBox unique dans l'app, donc sélecteur stable. */
const RULE_LINE = 'svg[viewBox="0 0 220 3"] line';

declare global {
  interface Window {
    __fxAttrLog?: Array<{ name: string; value: string | null }>;
  }
}

/**
 * Installe l'observateur AVANT le document. Il enregistre chaque écriture des
 * deux attributs que Framer pilote, sur tout le sous-arbre.
 */
const OBSERVER = `
  window.__fxAttrLog = [];
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== 'attributes' || !r.attributeName) continue;
      const el = r.target;
      if (!(el instanceof Element) || el.tagName.toLowerCase() !== 'line') continue;
      const svg = el.closest('svg');
      if (!svg || svg.getAttribute('viewBox') !== '0 0 220 3') continue;
      window.__fxAttrLog.push({ name: r.attributeName, value: el.getAttribute(r.attributeName) });
    }
    // ⚠️ CIBLE = \`document\`, PAS \`document.documentElement\`.
    // \`addInitScript\` s'exécute à document-start, quand \`documentElement\` peut
    // encore être null : \`observe(null)\` lève, le script meurt, et le journal
    // reste vide. On conclurait alors « aucune animation » sur une page qui
    // s'anime très bien — faux négatif mesuré le 2026-07-30 (0 écriture sur
    // TOUTE la page, ce qui est impossible pour une app React qui s'hydrate).
  }).observe(document, { attributes: true, subtree: true });
`;

test.describe('Mouvement réduit — le correctif d’hydratation n’a pas tué l’animation', () => {
  test.beforeAll(async () => {
    await cleanupTestUsers();
    await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'Alex',
      lastName: 'Démo',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
  });

  for (const mode of ['no-preference', 'reduce'] as const) {
    const anime = mode === 'no-preference';

    test(`prefers-reduced-motion: ${mode} — l’entrée ${anime ? 'joue' : 'ne joue pas'}, et l’état final est atteint`, async ({
      page,
      request,
    }) => {
      // Compilation à froid d’une route : généreux à dessein (mesuré 59 s à 199 s
      // sur ce poste), sans rapport avec ce que le test prouve.
      test.setTimeout(240_000);

      await page.emulateMedia({ reducedMotion: mode });
      await page.addInitScript(OBSERVER);

      await loginAs(page, request, MEMBER_EMAIL, MEMBER_PASSWORD);
      await page.goto('/mindset');

      const line = page.locator(RULE_LINE).first();
      await line.waitFor({ state: 'attached', timeout: 120_000 });

      // Laisser l’entrée se dérouler entièrement (delay 0.1 s + durée 0.9 s).
      await page.waitForTimeout(2_500);

      const final = {
        dashoffset: await line.getAttribute('stroke-dashoffset'),
        dasharray: await line.getAttribute('stroke-dasharray'),
      };
      const log = (await page.evaluate(() => window.__fxAttrLog ?? [])) as Array<{
        name: string;
        value: string | null;
      }>;

      // ── Invariant commun aux deux modes : l’état FINAL est atteint ──────────
      //
      // C’est la moitié « accessibilité » du contrat. Le défaut d’origine
      // laissait précisément l’élément figé dans l’état d’ENTRÉE (`0 1`), donc
      // invisible, pour les membres en mouvement réduit. `pathLength: 1` se
      // sérialise en `1 1` / offset `0` : tout autre couple = trait tronqué.
      expect(
        final.dasharray,
        `le trait n’a pas atteint son état final (dasharray=${final.dasharray}) — il reste partiellement dessiné, donc partiellement invisible`,
      ).toBe('1 1');
      expect(Number(final.dashoffset ?? '1')).toBeCloseTo(0, 5);

      // Framer normalise `pathLength` : la cible se lit `stroke-dasharray="1 1"`
      // avec un `stroke-dashoffset` nul. Toute autre valeur écrite EN COURS DE
      // ROUTE est une image intermédiaire, donc la preuve que ça bouge.
      const intermediaires = log.filter(
        (e) =>
          (e.name === 'stroke-dashoffset' && Math.abs(Number(e.value ?? '0')) > 1e-4) ||
          (e.name === 'stroke-dasharray' && e.value !== null && e.value !== '1 1'),
      );

      if (anime) {
        // ── Le membre qui ACCEPTE le mouvement voit bien l’entrée ────────────
        //
        // Sans cette assertion, un correctif qui neutraliserait `armed` pour
        // tout le monde rendrait toutes les surfaces vertes tout en supprimant
        // les animations du produit — une régression invisible aux autres tests.
        expect(
          intermediaires.length,
          `aucune valeur intermédiaire écrite sur le trait : l’animation d’entrée n’a jamais joué ` +
            `alors que le membre accepte le mouvement. ` +
            `\`useAfterHydration()\` ne repasse probablement plus à true. ` +
            `Journal complet (${log.length} écritures) : ${JSON.stringify(log.slice(0, 12))}`,
        ).toBeGreaterThan(0);
      } else {
        // ── Le membre qui DEMANDE moins de mouvement n’en reçoit aucun ───────
        //
        // Le filet est double et c’est voulu : `MotionConfig reducedMotion="user"`
        // neutralise côté Framer, et `armed` reste faux. Une seule valeur
        // intermédiaire écrite prouverait qu’un des deux a lâché.
        expect(
          intermediaires,
          `le trait a été animé alors que le membre demande un mouvement réduit — ` +
            `valeurs intermédiaires écrites : ${JSON.stringify(intermediaires.slice(0, 12))}`,
        ).toEqual([]);
      }
    });
  }

  /**
   * LE CHEMIN NORMAL — une NAVIGATION CLIENT, pas un rechargement complet.
   *
   * Les deux tests ci-dessus chargent la page à froid : le composant s'hydrate,
   * donc `useAfterHydration()` passe de `false` à `true`, la prop `animate`
   * change, et Framer anime. Un membre qui clique dans la navigation ne fait
   * jamais ça : le composant se monte alors que l'hydratation est DÉJÀ finie,
   * donc `armed` vaut `true` dès le premier rendu — et la prop `animate` ne
   * change plus jamais ensuite.
   *
   * Une revue adverse a soutenu que, dans ce cas, `initial={false}` ferait
   * peindre la cible sans animer, et que l'entrée serait donc morte sur le
   * chemin le plus fréquent de l'app. MESURÉ LE 2026-07-30 : c'est FAUX pour ce
   * composant — Framer, avec `initial={false}` et des keyframes `[0, 1]`, part
   * bien de la première image et anime. Ce test reste, non pour signaler un
   * défaut, mais pour épingler une propriété qu'aucun autre oracle ne couvrait :
   * les deux tests ci-dessus ne prouvent que le rechargement complet, qui est
   * le cas le plus RARE.
   */
  test('navigation client — l’entrée joue aussi quand le composant se monte après l’hydratation', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await loginAs(page, request, MEMBER_EMAIL, MEMBER_PASSWORD);

    // Partir d'une AUTRE surface, puis rejoindre /mindset par un clic : le
    // routeur App Router ne recharge pas le document, il monte le composant.
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // L'observateur est posé APRÈS le chargement du tableau de bord : tout ce
    // qu'il enregistre appartient donc à la navigation client qui suit.
    await page.evaluate(() => {
      window.__fxAttrLog = [];
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type !== 'attributes' || !r.attributeName) continue;
          const el = r.target;
          if (!(el instanceof Element) || el.tagName.toLowerCase() !== 'line') continue;
          const svg = el.closest('svg');
          if (!svg || svg.getAttribute('viewBox') !== '0 0 220 3') continue;
          window.__fxAttrLog?.push({
            name: r.attributeName,
            value: el.getAttribute(r.attributeName),
          });
        }
      }).observe(document, { attributes: true, subtree: true });
    });

    const lien = page.getByRole('link', { name: 'Mindset', exact: true }).first();
    await lien.waitFor({ state: 'visible', timeout: 60_000 });
    await lien.click();
    await page.waitForURL('**/mindset', { timeout: 120_000 });

    const line = page.locator(RULE_LINE).first();
    await line.waitFor({ state: 'attached', timeout: 120_000 });
    await page.waitForTimeout(2_500);

    const log = (await page.evaluate(() => window.__fxAttrLog ?? [])) as Array<{
      name: string;
      value: string | null;
    }>;
    const intermediaires = log.filter(
      (e) =>
        (e.name === 'stroke-dashoffset' && Math.abs(Number(e.value ?? '0')) > 1e-4) ||
        (e.name === 'stroke-dasharray' && e.value !== null && e.value !== '1 1'),
    );

    expect(
      intermediaires.length,
      `l’entrée n’a pas joué sur une navigation CLIENT — le composant se monte avec ` +
        `\`armed\` déjà vrai, et \`initial={false}\` fait peindre la cible sans animer. ` +
        `Journal (${log.length} écritures) : ${JSON.stringify(log.slice(0, 10))}`,
    ).toBeGreaterThan(0);

    await expect(page.locator(RULE_LINE).first()).toHaveAttribute('stroke-dasharray', '1 1');
  });
});
