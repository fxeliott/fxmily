/**
 * J10 correctif n°3 — LA source unique de vérité sur la caféine dans Fxmily.
 *
 * ## Le défaut
 *
 * Deux magasins décrivent la même journée du même membre, dans deux unités,
 * sans rien qui les relie :
 *
 * | Magasin                          | Champ              | Unité        | Écrit par            |
 * |----------------------------------|--------------------|--------------|----------------------|
 * | `DailyCheckin` (check-in du soir)| `caffeineMl`       | millilitres  | `app/checkin/actions`|
 * | `HabitLog` (`kind = 'caffeine'`) | `value.cups`       | tasses       | `app/track/actions`  |
 *
 * Le membre est donc sollicité deux fois pour la même information, et rien
 * dans le code ne dit que ces deux nombres parlent de la même chose. Le jour
 * où quelqu'un les additionne, les compare ou les moyenne, il produit un
 * chiffre faux sans qu'aucun test ne s'en aperçoive. Ce module est le seul
 * endroit où cette conversion existe, et le seul par lequel un consommateur
 * doit passer.
 *
 * ## Ce qu'il faut savoir avant de faire confiance à la conversion
 *
 * **Aucune norme ne fixe le volume d'une tasse de café.** Vérifié le
 * 2026-08-07 : `ISO 3509` (« Café et produits du café — Vocabulaire ») est un
 * texte purement terminologique et ne définit aucune dimension. Les repères
 * existants sont des usages constatés, pas des standards : un espresso servi
 * fait 25 à 40 ml, la tasse qui le contient 60 à 90 ml, un mug 250 à 350 ml.
 *
 * Conséquence assumée : `CAFFEINE_ML_PER_CUP` est une **convention de
 * produit**, pas une mesure. Toute valeur dérivée par conversion est marquée
 * `approximate: true` — c'est la seule façon honnête de rapprocher les deux
 * magasins sans fabriquer une précision qui n'existe pas.
 *
 * ## Époque des données (pattern `planRespected`)
 *
 * Aucune conversion rétroactive n'a été appliquée aux lignes existantes, et
 * c'est délibéré : une conversion exacte n'existe pas, donc réécrire
 * l'historique remplacerait une donnée honnête (« 2 tasses, déclarées ») par
 * une donnée inventée (« 250 ml, calculés »). Avant le **2026-08-07**, les
 * deux magasins coexistent sans lien ; après, tout lecteur qui a besoin de les
 * comparer passe par `resolveDailyCaffeine` et reçoit la provenance avec la
 * valeur.
 */

/** Unités dans lesquelles la caféine est déclarée quelque part dans l'app. */
export type CaffeineUnit = 'ml' | 'cups';

/** Magasin d'origine d'une déclaration de caféine. */
export type CaffeineSource = 'checkin' | 'track';

/**
 * Convention de produit : millilitres attribués à une « tasse » déclarée dans
 * le suivi d'habitude TRACK.
 *
 * 125 ml = le repère d'usage d'un café domestique français (entre l'espresso
 * servi, 25-40 ml, et le mug, 250-350 ml). **Ce n'est pas une norme** — voir
 * l'en-tête du module. Changer cette valeur ne corrompt aucune donnée stockée,
 * puisque rien n'est persisté sous forme convertie : elle n'agit qu'à la
 * lecture.
 */
export const CAFFEINE_ML_PER_CUP = 125;

/** Une déclaration de caféine, exprimée dans les deux unités, avec son origine. */
export interface CaffeineObservation {
  /** Valeur canonique, en millilitres. */
  ml: number;
  /** La même quantité en tasses (unité d'affichage du suivi d'habitude). */
  cups: number;
  /** Magasin qui a fourni la valeur brute. */
  source: CaffeineSource;
  /** Unité réellement saisie par le membre — l'autre est dérivée. */
  declaredUnit: CaffeineUnit;
  /**
   * `true` dès qu'une conversion tasses ↔ millilitres est intervenue. Un
   * consommateur qui affiche un chiffre issu d'une observation approximative
   * doit le présenter comme un ordre de grandeur, jamais comme une mesure.
   */
  approximate: boolean;
}

/** Millilitres → tasses, arrondi au dixième (au-delà, la précision est fausse). */
export function caffeineMlToCups(ml: number): number {
  return Math.round((ml / CAFFEINE_ML_PER_CUP) * 10) / 10;
}

/** Tasses → millilitres, arrondi à l'unité. */
export function caffeineCupsToMl(cups: number): number {
  return Math.round(cups * CAFFEINE_ML_PER_CUP);
}

/** Déclaration issue du check-in du soir (`DailyCheckin.caffeineMl`). */
export function caffeineFromCheckin(ml: number): CaffeineObservation {
  return {
    ml,
    cups: caffeineMlToCups(ml),
    source: 'checkin',
    declaredUnit: 'ml',
    approximate: true, // les tasses sont dérivées
  };
}

/** Déclaration issue du suivi d'habitude TRACK (`HabitLog.value.cups`). */
export function caffeineFromHabitLog(cups: number): CaffeineObservation {
  return {
    ml: caffeineCupsToMl(cups),
    cups,
    source: 'track',
    declaredUnit: 'cups',
    approximate: true, // les millilitres sont dérivés
  };
}

/**
 * Réconcilie les deux magasins pour UNE journée.
 *
 * Règle de priorité, et sa raison : quand les deux existent, **le check-in du
 * soir gagne**. Il porte une quantité physique déclarée par le membre lui-même
 * (des millilitres), là où le suivi d'habitude porte un décompte dont la
 * traduction en volume est une convention de ce module. Entre une mesure et
 * une convention, on garde la mesure.
 *
 * Ne renvoie JAMAIS la somme des deux : ce sont deux déclarations de la même
 * journée, pas deux consommations distinctes. Les additionner doublerait la
 * caféine d'un membre consciencieux — précisément la faute que ce module
 * rend impossible.
 */
export function resolveDailyCaffeine(input: {
  checkinMl?: number | null;
  trackCups?: number | null;
}): CaffeineObservation | null {
  const { checkinMl, trackCups } = input;
  if (typeof checkinMl === 'number' && Number.isFinite(checkinMl) && checkinMl >= 0) {
    return caffeineFromCheckin(checkinMl);
  }
  if (typeof trackCups === 'number' && Number.isFinite(trackCups) && trackCups >= 0) {
    return caffeineFromHabitLog(trackCups);
  }
  return null;
}
