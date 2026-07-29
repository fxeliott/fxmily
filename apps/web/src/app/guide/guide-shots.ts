import manifest from './guide-shots.manifest.json';

/**
 * Accès aux captures du guide — module PUR (aucun `node:*`), donc importable
 * par la page.
 *
 * Le manifeste est écrit par `tests/e2e/guide-surfaces-walk.spec.ts` quand on
 * lance `pnpm --filter @fxmily/web guide:shots`. Il est versionné : les
 * vignettes servies en production sont exactement celles que la CI a vues.
 *
 * L'outillage Node (calcul du hash de source, chemins disque) vit à part, dans
 * `src/test/guide-shot-source.ts`, et ne doit jamais remonter jusqu'ici.
 */

/** Une capture de surface, telle que le générateur l'enregistre. */
export interface GuideShotRecord {
  /** Nom du fichier dans `public/guide-shots/`. */
  file: string;
  /**
   * Empreinte des sources propres de la route au moment de la capture.
   *
   * Information, pas assertion : c'est le pré-contrôle bon marché du job de
   * régénération (`.github/workflows/guide-shots.yml`), qui évite de relancer
   * une capture complète quand aucun écran n'a bougé. `null` quand la route n'a
   * pas de dossier propre dans `src/app`.
   */
  sourceHash: string | null;
  /** Largeur en pixels de l'image écrite. */
  width: number;
  /** Hauteur en pixels de l'image écrite. */
  height: number;
}

export type GuideShotManifest = Record<string, GuideShotRecord>;

const SHOTS = manifest as GuideShotManifest;

/** Chemin public de la vignette, ou `null` si cette surface n'en a pas encore. */
export function guideShot(href: string): (GuideShotRecord & { src: string }) | null {
  const record = SHOTS[href];
  if (!record) return null;
  return { ...record, src: `/guide-shots/${record.file}` };
}
