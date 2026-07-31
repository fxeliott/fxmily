import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHOTS_PUBLIC_DIR,
  hashSourceFiles,
  routeSourceHash,
  shotSlug,
  type GuideShotManifest,
} from '@/test/guide-shot-source';

import manifestJson from './guide-shots.manifest.json';
import { GUIDE_CATALOG } from './guide-catalog';

const manifest = manifestJson as GuideShotManifest;

/**
 * Garde des captures du guide (J8 scope 2 — « 1 capture » par entrée).
 *
 * CE QUI EST GARDÉ, ET POURQUOI EXACTEMENT CELA.
 *
 * Le cas qui arrivera pour de vrai : quelqu'un ajoute une surface membre, le
 * garde de couverture (`guide-catalog.test.ts`) le force à écrire une entrée de
 * catalogue… et la carte s'affiche sans vignette, en silence. C'est CE trou que
 * ce fichier ferme : parité stricte manifeste ↔ catalogue, fichier réellement
 * présent sur le disque et non vide, aucune capture orpheline.
 *
 * CE QUI N'EST DÉLIBÉRÉMENT **PAS** GARDÉ : la péremption.
 *
 * Une capture se périme quand l'écran est refait. La tentation est d'assertion :
 * « le hash des sources de la route doit être celui enregistré à la capture ».
 * Ce garde-là a été écrit, puis retiré sur MESURE, pas sur intuition :
 * `git log --since="30 days ago" -- apps/web/src/app/dashboard/page.tsx` rend
 * **13 commits**, et l'ensemble des 22 dossiers de route du catalogue en cumule
 * plus de 130 sur le même mois. Un tel garde serait rouge une PR sur deux, et
 * exigerait à chaque fois une régénération Playwright complète (Postgres +
 * navigateurs) pour un commit qui n'a parfois changé qu'un commentaire.
 *
 * Un garde qu'on apprend à contourner ne garde rien.
 *
 * ⚠️ RECTIFICATION DU 2026-07-30 — CE COMMENTAIRE DÉSIGNAIT UN FILET INEXISTANT.
 *
 * Il disait : « la fraîcheur est traitée là où elle coûte zéro friction :
 * `.github/workflows/guide-shots.yml` régénère les vignettes et ouvre une PR
 * quand elles ont bougé ». Ce fichier n'existe pas (`ls .github/workflows/`), et
 * le workflow qui existe réellement — `guide-surfaces.yml` — REFUSE ce rôle par
 * écrit, dans son propre en-tête : une capture n'est pas déterministe d'un OS à
 * l'autre, un job nocturne ouvrirait une PR de 24 binaires chaque nuit sans
 * qu'un écran ait bougé.
 *
 * ⚠️ ET CETTE RECTIFICATION A ELLE-MÊME VIEILLI DANS LA JOURNÉE. Elle finissait
 * par « le `sourceHash` du manifeste n'est lu par personne » — c'était vrai le
 * matin, ça ne l'est plus : `guide-shots-staleness.test.ts` le relit chaque nuit
 * et signale les vignettes prises avant une refonte de leur route.
 *
 * L'état exact aujourd'hui, pour que la prochaine lecture n'ait pas à le
 * redécouvrir : la péremption n'est toujours PAS bloquante — le rapport tourne
 * dans `guide-surfaces.yml`, hors PR, en `continue-on-error`, pour la raison
 * mesurée plus haut. Ce qui bloque, à chaque PR, c'est la FORME du champ et le
 * fait que le job l'arme réellement (les deux tests plus bas). La régénération
 * reste un geste explicite : `pnpm --filter @fxmily/web guide:shots`.
 */
describe('guide shots — parité manifeste ↔ catalogue', () => {
  const catalogueHrefs = GUIDE_CATALOG.map((entry) => entry.href).sort();
  const manifestHrefs = Object.keys(manifest).sort();

  it('le catalogue n’est pas vide (garde de la garde)', () => {
    expect(GUIDE_CATALOG.length).toBeGreaterThan(0);
  });

  it('chaque entrée du catalogue a une capture déclarée, et réciproquement', () => {
    const missing = catalogueHrefs.filter((href) => !manifestHrefs.includes(href));
    const orphans = manifestHrefs.filter((href) => !catalogueHrefs.includes(href));

    expect(
      missing,
      missing.length
        ? `entrées de guide SANS capture : ${missing.join(', ')} — régénère avec ` +
            `\`pnpm --filter @fxmily/web guide:shots\``
        : '',
    ).toEqual([]);
    expect(
      orphans,
      orphans.length ? `captures pointant vers une surface disparue : ${orphans.join(', ')}` : '',
    ).toEqual([]);
  });

  it('chaque capture déclarée existe sur le disque, non vide, aux dimensions saines', () => {
    for (const [href, record] of Object.entries(manifest)) {
      const filePath = path.join(SHOTS_PUBLIC_DIR, record.file);
      expect(existsSync(filePath), `fichier manquant pour ${href} : ${record.file}`).toBe(true);

      const size = statSync(filePath).size;
      // Un WebP de moins de 1 ko serait une image blanche ou tronquée : la
      // présence du fichier ne prouve rien, son POIDS si.
      expect(size, `${record.file} pèse ${size} o — capture vide ou tronquée ?`).toBeGreaterThan(
        1024,
      );

      expect(record.width, `largeur de ${record.file}`).toBeGreaterThan(0);
      expect(record.height, `hauteur de ${record.file}`).toBeGreaterThan(0);
      expect(record.file, `nom de fichier dérivé du href pour ${href}`).toBe(
        `${shotSlug(href)}.webp`,
      );
    }
  });

  it('aucun fichier orphelin ne traîne dans public/guide-shots', () => {
    if (!existsSync(SHOTS_PUBLIC_DIR)) {
      // Pas encore de captures : la parité ci-dessus l'a déjà signalé.
      expect(Object.keys(manifest)).toEqual([]);
      return;
    }
    const declared = new Set(Object.values(manifest).map((record) => record.file));
    const onDisk = readdirSync(SHOTS_PUBLIC_DIR).filter((name) => name.endsWith('.webp'));
    const orphans = onDisk.filter((name) => !declared.has(name));
    expect(
      orphans,
      orphans.length ? `fichiers non déclarés au manifeste : ${orphans.join(', ')}` : '',
    ).toEqual([]);
  });

  /**
   * ⚠️ CE TEST S'APPELAIT « le pré-contrôle du job nocturne tient » ALORS QUE CE
   * JOB N'EXISTAIT PAS. `guide-surfaces.yml` n'avait aucune étape de péremption,
   * et `sourceHash` n'était relu par personne : le test gardait la calculabilité
   * d'une fonction au nom d'un travail imaginaire. Le rapport existe désormais
   * pour de vrai — `guide-shots-staleness.test.ts`, armé par
   * `GUIDE_SHOTS_STALENESS=1` dans le job nocturne — et ce test redevient ce
   * qu'il prétendait être : la garantie que ce rapport a de quoi travailler.
   */
  it('le hash de source reste calculable (sans quoi le rapport nocturne serait un no-op)', () => {
    // On ne compare PAS à la valeur enregistrée : c'est le rôle du rapport
    // nocturne, et une comparaison bloquante ici serait rouge sur un simple
    // commentaire (mesuré le 2026-07-30 sur `/guide`).
    const resolvable = GUIDE_CATALOG.filter((entry) => routeSourceHash(entry.href) !== null);
    expect(
      resolvable.length,
      'aucune route du catalogue ne résout vers un dossier src/app — le rapport serait mort',
    ).toBeGreaterThan(GUIDE_CATALOG.length / 2);
  });

  /**
   * L'EMPREINTE NE DOIT PAS DÉPENDRE DE LA PLATEFORME — appris par l'échec.
   *
   * Première version du rapport de péremption : verte sur mon poste, elle a
   * signalé **les 24 captures** au premier run CI. Cause : ce dépôt se checkout
   * en CRLF sous Windows et en LF sous Linux, donc chaque octet de chaque
   * fichier diffère entre l'auteur et le runner. Le rapport aurait été rouge
   * intégralement toutes les nuits — et un rapport toujours rouge ne se lit
   * plus.
   *
   * Le test ci-dessous est l'oracle de cette classe de bug, et il tourne à
   * CHAQUE PR : deux contenus identiques aux fins de ligne près doivent donner
   * la même empreinte, et un contenu réellement différent doit en donner une
   * autre (sans quoi « tout normaliser » réussirait en ne mesurant plus rien).
   */
  it('l’empreinte ignore les fins de ligne mais pas le contenu', () => {
    const lf = Buffer.from('export const a = 1;\nexport const b = 2;\n', 'utf8');
    const crlf = Buffer.from('export const a = 1;\r\nexport const b = 2;\r\n', 'utf8');
    const other = Buffer.from('export const a = 2;\nexport const b = 2;\n', 'utf8');

    expect(
      hashSourceFiles([{ name: 'page.tsx', content: crlf }]),
      'CRLF et LF doivent donner la même empreinte (poste Windows vs runner Linux)',
    ).toBe(hashSourceFiles([{ name: 'page.tsx', content: lf }]));

    expect(
      hashSourceFiles([{ name: 'page.tsx', content: other }]),
      'un contenu réellement différent doit encore bouger l’empreinte',
    ).not.toBe(hashSourceFiles([{ name: 'page.tsx', content: lf }]));

    expect(
      hashSourceFiles([{ name: 'autre.tsx', content: lf }]),
      'le NOM du fichier entre dans l’empreinte',
    ).not.toBe(hashSourceFiles([{ name: 'page.tsx', content: lf }]));
  });

  /**
   * ⚠️ `null` EST UNE VALEUR LÉGITIME, ET LA PREMIÈRE VERSION DE CE TEST L'AVAIT
   * OUBLIÉ. Elle exigeait 16 hex de TOUTE entrée, alors que `GuideShotRecord`
   * type le champ `string | null` et documente `null` « quand la route n'a pas
   * de dossier propre » — cas que le rapport de péremption traite lui-même comme
   * légitime. Une surface rendue par un segment dynamique parent aurait donc
   * rendu ce check requis rouge, en accusant un manifeste « hors forme » sur un
   * chemin que le code déclare supporté. Latent, mais c'est un piège posé.
   *
   * La règle exacte : `null` est admis SI ET SEULEMENT SI la route n'a
   * effectivement pas de dossier propre. Sinon, 16 hex — sans quoi le rapport
   * n'aurait plus rien à comparer et virerait vert par vacuité.
   */
  /**
   * LA FORME DU CHAMP, GARDÉE À CHAQUE PR — et c'est ici que la permanence se
   * joue vraiment.
   *
   * Le rapport de péremption ne tourne que la nuit. Si `sourceHash` disparaissait
   * du manifeste ou se remplissait de chaînes vides — une passe de « nettoyage »
   * du générateur suffit —, le rapport deviendrait vert par vacuité et personne
   * ne le saurait avant longtemps. Ce test-ci est instantané, tourne dans les
   * checks requis, et rend cette disparition impossible en silence.
   */
  it('chaque entrée porte un sourceHash de 16 hex, ou null si la route n’a pas de dossier', () => {
    for (const [href, record] of Object.entries(manifest)) {
      // ⚠️ LES DEUX DIRECTIONS, ET LA PREMIÈRE VERSION N'EN CÂBLAIT QU'UNE.
      // Elle vérifiait « manifeste null ⇒ la route n'a pas de dossier » et
      // s'arrêtait là — or la branche null est MORTE aujourd'hui (0 entrée sur
      // 24), donc la seule direction implémentée ne s'exécutait jamais. Le cas
      // qui arrivera pour de vrai est l'autre : une route qui PERD son dossier
      // propre (déplacement dans un route group, ou — vecteur ouvert par
      // l'exclusion des fichiers de test — dossier ne contenant plus qu'eux)
      // garde un hash figé dans le manifeste, et le rapport de péremption
      // compare alors une valeur périmée à `null` pour toujours.
      if (record.sourceHash === null) {
        expect(
          routeSourceHash(href),
          `${href} : sourceHash null alors que la route A un dossier propre — ` +
            `le rapport de péremption ne pourrait rien comparer pour elle`,
        ).toBeNull();
        continue;
      }
      expect(
        record.sourceHash,
        `${href} : sourceHash hors forme — le rapport de péremption ` +
          `(guide-shots-staleness.test.ts) n'aurait plus rien à comparer`,
      ).toMatch(/^[0-9a-f]{16}$/);
      expect(
        routeSourceHash(href),
        `${href} : le manifeste porte un hash alors que la route n'a plus de dossier propre ` +
          `calculable — la valeur enregistrée est figée, et le rapport de péremption la ` +
          `comparerait éternellement à null sans jamais pouvoir redevenir vert`,
      ).not.toBeNull();
    }
  });

  /**
   * LE RAPPORT NOCTURNE EST-IL SEULEMENT ARMÉ ? — la garde qui manquait.
   *
   * Le rapport de péremption s'auto-saute sans `GUIDE_SHOTS_STALENESS=1`, et sa
   * propre « garde de la garde » vit À L'INTÉRIEUR du `describe.skipIf`. Elle ne
   * peut donc pas voir le désarmement le plus probable : quelqu'un renomme la
   * variable ou retire l'étape, tout se saute, exit 0, et le `continue-on-error`
   * du job masque jusqu'à l'absence de sortie. Vérifié : sans la variable, la
   * commande rend « 2 skipped » et sort en 0.
   *
   * Ce test-ci regarde donc le WORKFLOW depuis les checks requis. Même technique
   * que `j8-mount-sites.test.ts` : un garde de source vaut mieux qu'un garde
   * qu'on croit armé.
   */
  it('le workflow nocturne arme réellement le rapport de péremption', () => {
    const workflow = readFileSync(
      path.resolve(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '.github',
        'workflows',
        'guide-surfaces.yml',
      ),
      'utf8',
    );

    // ⚠️ ON ISOLE LE BLOC DE L'ÉTAPE AVANT D'ASSERTER, ET C'EST UNE CORRECTION.
    // La première rédaction faisait `workflow.includes("github.event_name !=
    // 'pull_request'")` sur le fichier ENTIER. Or cette chaîne figure aussi dans
    // le commentaire qui explique la condition : retirer la condition du `if:`
    // laissait donc le test VERT (mesuré — mutation appliquée, 8 tests passés).
    // Un garde qui se contente d'une présence textuelle quelque part dans un
    // fichier ne garde pas un comportement ; on lie chaque assertion à l'étape.
    const step = /- name: Report stale guide thumbnails[\s\S]*?(?=\n {6}- name:|\n {4}\w|$)/.exec(
      workflow,
    )?.[0];

    expect(
      step,
      "guide-surfaces.yml n'a plus d'étape « Report stale guide thumbnails » — le rapport ne " +
        'tournerait nulle part et personne ne verrait une vignette périmée',
    ).toBeTruthy();

    expect(
      /run:[^\n]*guide-shots-staleness\.test\.ts/.test(step ?? ''),
      "l'étape ne lance plus `guide-shots-staleness.test.ts`",
    ).toBe(true);
    expect(
      /GUIDE_SHOTS_STALENESS:\s*'1'/.test(step ?? ''),
      "l'étape n'arme plus GUIDE_SHOTS_STALENESS : le rapport se sauterait en silence, exit 0",
    ).toBe(true);
    expect(
      /^\s*if:[^\n]*github\.event_name\s*!=\s*'pull_request'/m.test(step ?? ''),
      'le rapport doit rester hors des PR : plusieurs des chemins qui déclenchent ce workflow ' +
        "entrent dans l'empreinte de /guide, il serait rouge par construction",
    ).toBe(true);

    // ⚠️ ET UN DÉCLENCHEUR DOIT ENCORE POUVOIR LE LANCER — ce garde-ci l'avait
    // oublié, et une revue l'a prouvé en supprimant `schedule:` : les 8 tests
    // restaient VERTS alors que le rapport ne pouvait plus tourner nulle part
    // automatiquement (l'étape s'exclut elle-même des PR, il ne restait que le
    // déclenchement manuel). Vérifier qu'une étape est bien câblée ne prouve
    // rien si plus rien ne l'appelle : c'est la version workflow de
    // « présence ≠ comportement ».
    expect(
      /^\s{2}schedule:\s*\n\s+- cron:/m.test(workflow),
      "guide-surfaces.yml n'a plus de `schedule:` — l'étape de péremption s'excluant des PR, " +
        'plus aucun déclencheur automatique ne peut la lancer et une vignette périmée ne serait ' +
        'jamais signalée',
    ).toBe(true);
  });
});
