import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Outillage Node des captures du guide (J8 scope 2 — « 1 capture » par entrée).
 *
 * ⚠️ Module **test/outil uniquement** : il touche `node:fs`. Il ne doit JAMAIS
 * être importé par une page ou un composant. La page, elle, ne lit que le
 * manifeste JSON (`src/app/guide/guide-shots.manifest.json`), qui est de la
 * donnée pure.
 *
 * Deux consommateurs, et c'est le point :
 *   - le générateur (`tests/e2e/guide-surfaces-walk.spec.ts`) ÉCRIT le hash de
 *     source de chaque route au moment où il prend la capture ;
 *   - le garde (`src/app/guide/guide-shots.test.ts`) RECALCULE ce hash et casse
 *     s'il a bougé.
 *
 * Ce n'est pas une tautologie (la fonction est la même des deux côtés, mais son
 * ENTRÉE — le contenu des fichiers — change dans le temps) : c'est exactement ce
 * qui rend la péremption détectable. Une capture prise avant une refonte de
 * `dashboard/page.tsx` devient rouge à la première exécution de la suite.
 *
 * CE QUE CE GARDE NE VOIT PAS, dit franchement : le hash ne couvre que les
 * fichiers du dossier de la route elle-même. Une refonte d'un composant partagé
 * (`components/ui/card.tsx`, un token de `globals.css`) change l'écran sans
 * changer ce hash. Hasher tout l'arbre d'imports rendrait le garde rouge à
 * chaque commit et il finirait désarmé — un garde qu'on ignore ne garde rien.
 * Le filet retenu attrape le cas de loin le plus fréquent (on refait l'écran, on
 * oublie sa capture) et l'assume pour le reste.
 */

/** Racine `src/app`, résolue depuis ce fichier (`src/test/`). */
const APP_ROOT = path.resolve(import.meta.dirname, '..', 'app');

/** Dossier public des captures. */
export const SHOTS_PUBLIC_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'guide-shots',
);

/** Chemin du manifeste versionné. */
export const SHOTS_MANIFEST_PATH = path.resolve(
  import.meta.dirname,
  '..',
  'app',
  'guide',
  'guide-shots.manifest.json',
);

/**
 * `/checkin/history` → `checkin-history`, `/dashboard` → `dashboard`.
 *
 * Nom de fichier stable, sans slash, dérivé de l'unique identifiant que le
 * catalogue possède déjà (le `href`) — jamais un libellé, qui bouge.
 */
export function shotSlug(href: string): string {
  const trimmed = href.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? 'root' : trimmed.replace(/\//g, '-');
}

/**
 * Le dossier de route App Router correspondant à un `href`.
 *
 * L'arbre `src/app` de ce repo est PLAT (aucun route group `(...)` — vérifié),
 * donc le href se traduit segment par segment. Retourne `null` si le dossier
 * n'existe pas : une route rendue par un segment dynamique parent n'a pas de
 * dossier propre, et c'est un cas légitime, pas une erreur.
 */
export function routeDir(href: string): string | null {
  const segments = href.split('/').filter(Boolean);
  const dir = path.join(APP_ROOT, ...segments);
  return existsSync(dir) ? dir : null;
}

/**
 * Empreinte des sources PROPRES de la route (non récursif).
 *
 * Non récursif à dessein : `src/app/journal/` contient `new/`, qui est une autre
 * surface avec sa propre vie. Descendre y ferait rougir la capture de `/journal`
 * à chaque retouche d'un écran voisin.
 *
 * Retourne `null` quand la route n'a pas de dossier propre — le garde saute
 * alors la vérification de péremption pour cette entrée, en le disant.
 */
export function routeSourceHash(href: string): string | null {
  const dir = routeDir(href);
  if (!dir) return null;

  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx|ts|css)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) return null;

  const hash = createHash('sha256');
  for (const name of files) {
    // Le NOM entre dans l'empreinte : supprimer un fichier de la route doit
    // suffire à la faire bouger, même si le reste est inchangé.
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(path.join(dir, name)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

// Les TYPES du manifeste vivent avec la page (`src/app/guide/guide-shots.ts`,
// module pur) : une seule définition, et c'est celle que le rendu utilise. Les
// ré-exporter ici évite au générateur et au garde d'importer deux chemins.
export type { GuideShotManifest, GuideShotRecord } from '@/app/guide/guide-shots';
