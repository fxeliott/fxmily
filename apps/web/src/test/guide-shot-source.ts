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
 * ⚠️ CE FICHIER A LONGTEMPS DÉCRIT UN GARDE QUI N'EXISTE PAS. Rectifié le
 * 2026-07-30, après qu'une revue adverse l'a mesuré.
 *
 * Le texte précédent affirmait, comme un fait : « le garde
 * (`guide-shots.test.ts`) RECALCULE ce hash et casse s'il a bougé […] une
 * capture prise avant une refonte de `dashboard/page.tsx` devient rouge ».
 * Vérifiable en une commande — `grep -rn sourceHash apps/web/src apps/web/tests`
 * — et faux : le champ est ÉCRIT par le générateur
 * (`tests/e2e/guide-surfaces-walk.spec.ts:342`) et n'est LU par personne. Aucune
 * péremption n'est détectée nulle part dans le dépôt.
 *
 * Un commentaire qui ment est pire qu'un commentaire absent : il fait passer le
 * relecteur suivant — moi compris — à côté du trou en le lui décrivant comme
 * couvert. D'où cette rectification, avant tout autre travail sur le sujet.
 *
 * CE QUE LE CHAMP EST RÉELLEMENT, aujourd'hui : une trace de PROVENANCE. Il
 * enregistre l'état des sources de la route à l'instant où sa capture a été
 * prise, ce qui permet à un humain — ou à une future porte — de dire « cette
 * vignette date d'avant telle refonte ». Rien de plus — et pour être exact
 * jusqu'au bout : AUCUNE assertion ne lit ce champ, pas même pour vérifier qu'il
 * est présent. Le manifeste est simplement typé `as GuideShotManifest`.
 *
 * POURQUOI PAS DE PORTE BLOQUANTE, décision mesurée et maintenue :
 * `dashboard/page.tsx` totalise 13 commits sur 30 jours, l'ensemble des routes
 * plus de 130. Une assertion de péremption serait rouge une PR sur deux et
 * exigerait à chaque fois une régénération Playwright complète pour un commit
 * qui n'a parfois changé qu'un commentaire. Un garde qu'on apprend à contourner
 * ne garde rien. La conséquence est assumée ET ÉCRITE : la péremption d'une
 * vignette n'est, à ce jour, rattrapée par aucun automatisme.
 *
 * Limite supplémentaire du hash lui-même : il ne couvre que les fichiers du
 * dossier de la route. Une refonte d'un composant partagé (`components/ui/…`,
 * un token de `globals.css`) change l'écran sans changer ce hash.
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
 * Empreinte d'une liste de fichiers `(nom, contenu)`. Pure, testable, sans I/O.
 *
 * ⚠️ LES FINS DE LIGNE SONT NORMALISÉES, ET C'EST OBLIGATOIRE — pas une
 * élégance. Sans ça, l'empreinte dépend de la plateforme : ce dépôt se checkout
 * en CRLF sur un poste Windows et en LF sur un runner Linux, donc CHAQUE octet
 * de CHAQUE fichier diffère entre les deux. Mesuré le 2026-07-30, et par le
 * pire chemin : le rapport de péremption était vert en local et signalait
 * **les 24 captures** sur le premier run CI. Un rapport rouge intégralement,
 * toutes les nuits, ne dit plus rien — on apprend à ne plus le lire, et la
 * vraie dérive se noie dedans.
 *
 * Une fin de ligne ne change pas un pixel du rendu. La normaliser retire donc
 * du bruit sans retirer un seul signal.
 */
export function hashSourceFiles(files: ReadonlyArray<{ name: string; content: Buffer }>): string {
  const hash = createHash('sha256');
  for (const { name, content } of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    // Le NOM entre dans l'empreinte : supprimer un fichier de la route doit
    // suffire à la faire bouger, même si le reste est inchangé.
    hash.update(name);
    hash.update('\0');
    hash.update(content.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
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

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx|ts|css)$/.test(entry.name))
    .map((entry) => entry.name);

  if (names.length === 0) return null;

  return hashSourceFiles(
    names.map((name) => ({ name, content: readFileSync(path.join(dir, name)) })),
  );
}

// Les TYPES du manifeste vivent avec la page (`src/app/guide/guide-shots.ts`,
// module pur) : une seule définition, et c'est celle que le rendu utilise. Les
// ré-exporter ici évite au générateur et au garde d'importer deux chemins.
export type { GuideShotManifest, GuideShotRecord } from '@/app/guide/guide-shots';
