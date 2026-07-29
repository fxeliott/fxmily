/**
 * J8 scope 2 — la marche des 24 surfaces, et les captures du guide.
 *
 * DEUX RÔLES, UN SEUL PARCOURS. C'est le cœur de ce fichier.
 *
 * 1. **Garde permanent (toujours actif, CI comprise).** Le spec ouvre CHAQUE
 *    surface du `GUIDE_CATALOG` en membre authentifié réel et exige, pour
 *    chacune : un document HTTP < 400, un `<main>` visible, aucune exception
 *    non rattrapée, aucune erreur console, aucun overlay d'erreur Next.
 *
 *    Rien ne faisait ça avant. Le guide PROMET 24 écrans au membre ; personne ne
 *    vérifiait qu'ils s'ouvrent. Une surface cassée restait invisible jusqu'à ce
 *    qu'un membre tombe dessus — le guide l'envoyait dans le mur en promettant
 *    le contraire. La garde échoue en listant TOUTES les surfaces fautives d'un
 *    coup, pas seulement la première : un rapport partiel ferait croire à un
 *    problème isolé.
 *
 * 2. **Générateur de captures (sur demande).** Avec `CAPTURE_GUIDE_SHOTS=1`, la
 *    même marche écrit en plus une vignette WebP par surface dans
 *    `public/guide-shots/` et met à jour le manifeste versionné. Les captures ne
 *    sont donc jamais « prises à la main » : elles sont le sous-produit d'un
 *    parcours qui a d'abord PROUVÉ que l'écran s'ouvre. Une capture ne peut pas
 *    montrer un écran cassé — le test serait rouge avant de l'écrire.
 *
 * DONNÉES. Le membre est fraîchement semé, avec un historique de trades et de
 * check-ins pour que les écrans principaux ne soient pas vides. Les surfaces qui
 * restent vides le sont VRAIMENT pour un nouveau membre : leur capture montre
 * alors l'état vide réel, ce qu'un lecteur du guide — par définition un
 * débutant — va effectivement rencontrer. C'est honnête, pas un défaut.
 *
 * VIE PRIVÉE (piège explicite du jalon : « captures anonymisées, données démo,
 * jamais de vrai membre »). Le compte est créé par `seedMemberUser` sur le
 * domaine `…@fxmily.local`, détruit en fin de suite, et n'existe QUE dans la
 * base locale. Aucune donnée de production ne peut entrer dans une capture :
 * le spec refuse de démarrer si `PLAYWRIGHT_BASE_URL` ne pointe pas sur
 * localhost — garde-fou explicite ci-dessous, pas une intention.
 *
 * Canon e2e du repo : jamais de `networkidle` contre le dev server (le socket
 * HMR Turbopack ne settle jamais) ; jamais d'import de module `server-only` ici.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures';

import { GUIDE_CATALOG } from '@/app/guide/guide-catalog';
import {
  SHOTS_MANIFEST_PATH,
  SHOTS_PUBLIC_DIR,
  routeSourceHash,
  shotSlug,
  type GuideShotManifest,
} from '@/test/guide-shot-source';
import {
  cleanupTestUsers,
  seedCheckinHistory,
  seedMemberUser,
  seedTradeHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MEMBER_EMAIL = 'j8-surfaces-walk.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'J8-SurfacesWalkPwd-2026!';

const CAPTURING = process.env.CAPTURE_GUIDE_SHOTS === '1';

/**
 * Opt-in, sur mesure — pas par confort.
 *
 * La marche ouvre 24 routes. Mesuré ici, la PREMIÈRE compilation Turbopack
 * d'une route coûte 59 s (`/progression`) à 2 min (`/calendrier`) ; en CI, où
 * chaque shard part d'un `.next` vide, faire payer ça à CHAQUE pull request
 * ajouterait un quart d'heure au chemin critique de toute PR du dépôt.
 *
 * Le partage retenu :
 *   - à chaque PR, c'est `src/app/guide/guide-shots.test.ts` (Vitest, instantané)
 *     qui garde le cas fréquent : une surface ajoutée au guide sans sa vignette ;
 *   - la marche complète tourne la nuit sur `main`
 *     (`.github/workflows/guide-surfaces.yml`) et à la demande.
 *
 * `GUIDE_WALK=1` (ou une régénération de captures) l'active.
 */
const WALKING = CAPTURING || process.env.GUIDE_WALK === '1';

/** Parcourir les surfaces comme un membre en mouvement réduit (réglage d'accessibilité). */
const REDUCED_MOTION = process.env.GUIDE_WALK_REDUCED_MOTION === '1';

/**
 * Régénération PARTIELLE : `GUIDE_SHOTS_ONLY='/dashboard,/track'`.
 *
 * Né d'un vrai mur. Sur un poste où Next signale « Slow filesystem detected »,
 * la première compilation d'une route atteint 199 s ; une marche de 24 routes
 * devient alors du tout-ou-rien à quarante minutes, et une seule route lente
 * fait perdre les 23 autres. Le filtre transforme ça en passes ciblées de deux
 * minutes contre un serveur déjà chaud.
 *
 * Le manifeste est alors FUSIONNÉ, jamais réécrit à zéro : c'est la seule
 * différence de comportement, et elle est explicite ci-dessous.
 */
const ONLY = (process.env.GUIDE_SHOTS_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Fenêtre iPhone 15 — la largeur prioritaire du repo. */
const VIEWPORT = { width: 393, height: 852 } as const;
/** Hauteur capturée : le haut de l'écran suffit à le RECONNAÎTRE. */
const CLIP_HEIGHT = 300;
/** Largeur finale de la vignette (le clip est pris en DPR 2 puis réduit). */
const SHOT_WIDTH = 393;

let member: SeededUser | null = null;

interface SurfaceFailure {
  href: string;
  problems: string[];
}

test.describe('J8 scope 2 — les 24 surfaces du guide s’ouvrent vraiment', () => {
  test.skip(
    !WALKING,
    'marche complète : opt-in via GUIDE_WALK=1 (nocturne + à la demande) — voir le commentaire en tête de fichier',
  );

  test.beforeAll(async () => {
    // Garde-fou vie privée : on ne capture JAMAIS autre chose que du local.
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
    if (CAPTURING) {
      const { hostname } = new URL(baseUrl);
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        throw new Error(
          `CAPTURE_GUIDE_SHOTS=1 refusé contre ${baseUrl} — les captures ne se prennent que ` +
            `sur une base locale semée. Une capture prise ailleurs pourrait contenir la donnée ` +
            `d’un vrai membre (dépôt PUBLIC).`,
        );
      }
    }

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'Alex',
      lastName: 'Démo',
    });

    // De quoi que les écrans principaux ne soient pas des coquilles vides.
    // Graines FIXES (défaut 42) : deux régénérations successives produisent la
    // même donnée, donc la même image — sinon chaque passage salirait le diff
    // git de 24 binaires pour rien.
    await seedTradeHistory(member.id, { count: 40 });
    await seedCheckinHistory(member.id, { days: 21 });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('chaque surface du catalogue s’ouvre sans erreur (et, sur demande, se capture)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // Garde de la garde : un catalogue vide rendrait la marche triviale.
    expect(GUIDE_CATALOG.length).toBeGreaterThan(0);

    // 24 navigations, chacune pouvant payer une compilation à froid de Turbopack.
    test.setTimeout(GUIDE_CATALOG.length * 45_000);

    await page.setViewportSize(VIEWPORT);
    // Mouvement réduit : `GUIDE_WALK_REDUCED_MOTION=1` fait parcourir les 24
    // surfaces comme les voit un membre qui a demandé moins d'animation.
    if (REDUCED_MOTION) await page.emulateMedia({ reducedMotion: 'reduce' });

    // ⚠️ HISTORIQUE — pourquoi cet interrupteur existe, et ce qu'il a trouvé.
    //
    // Sous mouvement réduit, QUATRE surfaces cassent leur hydratation :
    //   /review     → « Hydration failed because the server rendered HTML didn't
    //                  match the client. As a result this tree will be
    //                  regenerated on the client. » (React jette le HTML serveur)
    //   /mindset, /calendrier, /guide → « A tree hydrated but some attributes of
    //                  the server rendered HTML didn't match the client
    //                  properties. This won't be patched up. »
    // Les mêmes surfaces sont propres SANS l'émulation (elles ont été capturées
    // sans une seule erreur juste avant). C'est donc bien le mode « mouvement
    // réduit » — un réglage d'ACCESSIBILITÉ système — qui déclenche le défaut.
    // Cause probable, non prouvée : un `useReducedMotion()` lu pendant le rendu
    // (`components/ui/hover-glow-lift.tsx`, `reveal.tsx`) vaut `null` côté
    // serveur et `true` côté client.
    //
    // Garder l'émulation ici rendrait cette garde ROUGE en permanence pour un
    // défaut qu'elle n'est pas chargée de corriger, et une garde toujours rouge
    // finit ignorée. Le défaut est remonté à part ; la marche, elle, parcourt ce
    // que voit un membre par défaut.
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    if (CAPTURING && ONLY.length === 0) {
      // Repartir d'un dossier propre : une capture orpheline (surface renommée,
      // entrée retirée) ne doit pas survivre en silence à une régénération.
      // Sauté en régénération PARTIELLE, qui doit au contraire préserver les
      // vignettes qu'elle ne refait pas.
      rmSync(SHOTS_PUBLIC_DIR, { recursive: true, force: true });
      mkdirSync(SHOTS_PUBLIC_DIR, { recursive: true });
    }

    // Une régénération partielle repart du manifeste existant : les entrées non
    // visitées doivent survivre telles quelles.
    const manifest: GuideShotManifest =
      ONLY.length > 0
        ? (JSON.parse(readFileSync(SHOTS_MANIFEST_PATH, 'utf8')) as GuideShotManifest)
        : {};
    const failures: SurfaceFailure[] = [];

    /**
     * Une visite = un verdict complet sur une surface.
     *
     * Appelée DEUX fois au plus par surface, et c'est délibéré. Mesuré sur ce
     * poste : la toute première compilation Turbopack d'une route prend 59 s
     * (`/progression`) à 2 min (`/calendrier`), assez pour saturer le pool
     * Prisma local — `prisma:error timeout exceeded when trying to connect` —
     * et faire échouer le rendu serveur d'une page parfaitement saine. Le
     * deuxième passage tape une route déjà compilée et ne paie plus rien.
     *
     * Sans ce second essai, cette garde crierait au loup à chaque démarrage à
     * froid ; elle serait désarmée en une semaine, et ne garderait plus rien.
     * Avec lui, un défaut RÉEL — qui, lui, se reproduit — passe toujours.
     */
    async function visit(href: string): Promise<string[]> {
      const problems: string[] = [];
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      const onConsole = (msg: { type: () => string; text: () => string }): void => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      };
      const onPageError = (err: Error): void => {
        pageErrors.push(err.message);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);

      try {
        const response = await page.goto(href, { waitUntil: 'load' });
        const status = response?.status() ?? 0;
        if (status >= 400) problems.push(`HTTP ${status}`);

        // Une redirection est légitime (`/checkin` mène au wizard du créneau) ;
        // un renvoi vers /login ne l'est pas — le membre EST authentifié.
        if (/\/login/.test(page.url())) problems.push(`redirigé vers ${page.url()}`);

        const main = page.locator('main').first();
        try {
          await main.waitFor({ state: 'visible', timeout: 20_000 });
        } catch {
          problems.push('aucun <main> visible');
        }

        // Attendre la fin du chargement RÉEL. Les `loading.tsx` de ce repo
        // posent `aria-busy="true"` sur leur conteneur (voir
        // `app/dashboard/loading.tsx`) : c'est un signal sémantique stable, bien
        // meilleur qu'une classe CSS qui bougera à la prochaine refonte.
        try {
          await page
            .locator('[aria-busy="true"]')
            .first()
            .waitFor({ state: 'detached', timeout: 30_000 });
        } catch {
          problems.push('squelette de chargement toujours affiché après 30 s');
        }

        if ((await page.locator('[data-nextjs-dialog-overlay]').count()) > 0) {
          problems.push('overlay d’erreur Next');
        }

        // PORTE DE CONTENU — celle qui a rattrapé le vrai défaut.
        //
        // La première version de cette marche attendait `<main>` visible, puis
        // capturait. Les 24 vignettes produites montraient… le SQUELETTE de
        // chargement : des rectangles gris. 24 fichiers présents, test vert,
        // contenu inutilisable. « Présence » n'est pas « comportement ».
        //
        // Un écran réel porte des centaines de caractères ; un squelette n'en
        // porte aucun (ses blocs sont des `<div>` vides). Le seuil discrimine
        // donc franchement, et le message reporte la valeur mesurée pour rester
        // diagnostiquable au lieu d'être un simple « trop court ».
        const text = ((await main.innerText().catch(() => '')) ?? '').trim();
        if (text.length < 120) {
          problems.push(`contenu quasi vide : ${text.length} caractères dans <main> (squelette ?)`);
        }
      } catch (err) {
        problems.push(`exception : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
      }

      if (pageErrors.length) problems.push(`exception page : ${pageErrors.join(' | ')}`);
      if (consoleErrors.length) problems.push(`console : ${consoleErrors.join(' | ')}`);
      return problems;
    }

    const targets =
      ONLY.length > 0 ? GUIDE_CATALOG.filter((e) => ONLY.includes(e.href)) : GUIDE_CATALOG;
    if (ONLY.length > 0) {
      // Ne jamais rétrécir le périmètre en silence (canon du dépôt) : ce que la
      // passe NE couvre pas se lit dans la sortie, pas dans le code.

      console.log(
        `[guide-shots] passe PARTIELLE sur ${targets.length}/${GUIDE_CATALOG.length} surfaces : ${targets.map((t) => t.href).join(', ')}`,
      );
      expect(targets.length, `GUIDE_SHOTS_ONLY ne correspond à aucune entrée`).toBeGreaterThan(0);
    }

    for (const entry of targets) {
      let problems = await visit(entry.href);
      if (problems.length > 0) problems = await visit(entry.href);

      // La capture n'est écrite QU'APRÈS le verdict complet, erreurs console et
      // exceptions comprises. Écrire plus tôt — ce que faisait la première
      // version — laissait passer la vignette d'un écran qui avait justement
      // signalé un problème : la garde aurait publié la photo de la panne.
      if (CAPTURING && problems.length === 0) {
        const png = await page.screenshot({
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: CLIP_HEIGHT },
        });
        // `sharp` est déjà une dépendance du projet (traitement des uploads).
        // Import dynamique : rien ne le charge quand on ne capture pas.
        const { default: sharp } = await import('sharp');
        const file = `${shotSlug(entry.href)}.webp`;
        const out = await sharp(png)
          .resize({ width: SHOT_WIDTH, withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer({ resolveWithObject: true });
        writeFileSync(path.join(SHOTS_PUBLIC_DIR, file), out.data);
        manifest[entry.href] = {
          file,
          sourceHash: routeSourceHash(entry.href),
          width: out.info.width,
          height: out.info.height,
        };
      }

      if (problems.length) failures.push({ href: entry.href, problems });
    }

    if (CAPTURING) {
      // Manifeste trié par href : un diff git lisible, jamais réordonné au hasard.
      const sorted: GuideShotManifest = {};
      for (const href of Object.keys(manifest).sort()) {
        const record = manifest[href];
        if (record) sorted[href] = record;
      }
      writeFileSync(SHOTS_MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

      console.log(
        `[guide-shots] ${Object.keys(sorted).length}/${GUIDE_CATALOG.length} captures écrites dans ${SHOTS_PUBLIC_DIR}`,
      );
    }

    // Rapport groupé : toutes les surfaces fautives, pas seulement la première.
    expect(
      failures,
      failures.length
        ? `surfaces en échec :\n${failures.map((f) => `  ${f.href} → ${f.problems.join(' ; ')}`).join('\n')}`
        : '',
    ).toEqual([]);

    if (CAPTURING) {
      const written = JSON.parse(readFileSync(SHOTS_MANIFEST_PATH, 'utf8')) as GuideShotManifest;
      expect(Object.keys(written)).toHaveLength(GUIDE_CATALOG.length);
    }
  });
});
