import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHOTS_PUBLIC_DIR,
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
 * Il n'y a donc AUCUN rattrapage de fraîcheur, ni bloquant ni asynchrone. Le
 * `sourceHash` du manifeste n'est lu par personne : c'est une trace de
 * provenance (cf. `src/test/guide-shot-source.ts`), pas un pré-contrôle. La
 * régénération reste un geste explicite : `pnpm --filter @fxmily/web guide:shots`.
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
   * LA FORME DU CHAMP, GARDÉE À CHAQUE PR — et c'est ici que la permanence se
   * joue vraiment.
   *
   * Le rapport de péremption ne tourne que la nuit. Si `sourceHash` disparaissait
   * du manifeste ou se remplissait de chaînes vides — une passe de « nettoyage »
   * du générateur suffit —, le rapport deviendrait vert par vacuité et personne
   * ne le saurait avant longtemps. Ce test-ci est instantané, tourne dans les
   * checks requis, et rend cette disparition impossible en silence.
   */
  it('chaque entrée porte un sourceHash de la forme attendue (16 hex)', () => {
    for (const [href, record] of Object.entries(manifest)) {
      expect(
        record.sourceHash,
        `${href} : sourceHash absent ou hors forme — le rapport de péremption ` +
          `(guide-shots-staleness.test.ts) n'aurait plus rien à comparer`,
      ).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
