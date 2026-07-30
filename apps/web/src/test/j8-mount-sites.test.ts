/**
 * LES CRITÈRES J8 QUI NE TIENNENT QU'À UN SITE DE MONTAGE.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le critère 1 du jalon J8 (`D:\Fxmily-jalons\J8-guide-pwa.md`) est : « iPhone
 * simulé, non-standalone → bandeau install visible + page étapes ». Le seul test
 * qui le prouve vraiment est la Gate 1 de `tests/e2e/j8-pwa-offline.spec.ts`,
 * et elle est encadrée par `test.skip(({ browserName }) => browserName !== 'webkit')`.
 * Elle ne s'exécute donc QUE dans le projet `mobile-iphone-15`, lancé par le seul
 * `.github/workflows/e2e-mobile.yml` — un workflow qui n'est PAS dans les
 * required checks de `main`.
 *
 * Conséquence mesurée le 2026-07-30 : on peut supprimer la ligne
 * `<IOSInstallHint />` de `src/app/dashboard/page.tsx` sans qu'un seul check
 * requis rougisse. Le test unitaire existant (`ios-install-hint.test.tsx`) rend
 * le composant EN ISOLATION : par construction, il ne peut pas voir qu'on a
 * cessé de le monter. Et le membre iPhone, lui, perdrait le seul chemin
 * d'installation — alors que le push iOS EXIGE la PWA installée.
 *
 * CE QUE CE GARDE EST, ET CE QU'IL N'EST PAS
 * ------------------------------------------
 * C'est une assertion STRUCTURELLE sur la source : elle ne prouve aucun
 * comportement (le rendu iOS réel reste la Gate 1, à sa place, sur WebKit). Elle
 * interdit la disparition SILENCIEUSE du site de montage, et elle le fait dans
 * un test Vitest — donc dans « Lint, type-check, build », qui EST un check
 * requis. C'est le seul filet disponible sans changer la protection de branche,
 * qui est une décision d'Eliot.
 *
 * Falsifiable : retirer `<IOSInstallHint />` de la page rend ce fichier rouge en
 * nommant le fichier et le composant.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '..', 'app');

/** Sites de montage dont dépend directement un critère « Done quand » du J8. */
const SITES = [
  {
    critere: 'J8 critère 1 — le membre iPhone a un chemin d’installation',
    fichier: 'dashboard/page.tsx',
    composant: 'IOSInstallHint',
    pourquoi:
      'sans ce montage, aucun membre iPhone ne voit le chemin d’installation ; ' +
      'or le push iOS exige la PWA installée. La Gate 1 qui le prouve au runtime ' +
      'ne tourne que sur WebKit, hors des required checks.',
  },
  {
    critere: 'J8 critère 3 — /offline tient sa promesse de rechargement',
    fichier: 'offline/page.tsx',
    composant: 'OfflineReload',
    pourquoi:
      'la page /offline promet un retour automatique dès que le réseau revient ; ' +
      'sans cette île, la promesse redevient le mensonge que le jalon demandait de fermer.',
  },
] as const;

describe('J8 — les sites de montage que les required checks ne voient pas', () => {
  for (const site of SITES) {
    it(`${site.critere} : <${site.composant} /> est monté dans ${site.fichier}`, () => {
      const source = readFileSync(path.join(APP, site.fichier), 'utf8');

      expect(
        source,
        `${site.fichier} n’importe plus ${site.composant} — ${site.pourquoi}`,
      ).toContain(site.composant);

      // Importé ne suffit pas : il faut qu'il soit RENDU. Un import orphelin
      // serait d'ailleurs signalé par le lint, pas par la couverture produit.
      expect(
        new RegExp(`<${site.composant}[\\s/>]`).test(source),
        `${site.fichier} importe ${site.composant} mais ne le rend plus — ${site.pourquoi}`,
      ).toBe(true);
    });
  }
});
