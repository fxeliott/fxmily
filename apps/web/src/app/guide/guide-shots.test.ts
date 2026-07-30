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

  it('le hash de source enregistré reste calculable (le pré-contrôle du job nocturne tient)', () => {
    // On ne compare PAS à la valeur enregistrée (cf. l'en-tête : mesuré, écarté).
    // On vérifie seulement que la fonction sur laquelle le job de régénération
    // s'appuie répond encore quelque chose pour les routes qui ont un dossier —
    // sinon le pré-contrôle nocturne deviendrait un no-op silencieux.
    const resolvable = GUIDE_CATALOG.filter((entry) => routeSourceHash(entry.href) !== null);
    expect(
      resolvable.length,
      'aucune route du catalogue ne résout vers un dossier src/app — le pré-contrôle serait mort',
    ).toBeGreaterThan(GUIDE_CATALOG.length / 2);
  });
});
