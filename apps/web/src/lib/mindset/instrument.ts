/**
 * V1.5 — QCM athlète: frozen, versioned mindset self-assessment instrument
 * (SPEC §27.3 / §27.7).
 *
 * LONGITUDINAL-VALIDITY INVARIANT (non-negotiable, SPEC §27.7):
 *  - This instrument is STATIC and VERSIONED. Item `id`s and `dimensionId`s
 *    are immutable contracts: once shipped, an id is NEVER renamed or reused
 *    for different wording. ANY change to items/dimensions/scale ⇒ a NEW
 *    `version` entry (bump). Trends are ONLY ever compared intra-version —
 *    the aggregator segments by `instrumentVersion`. Renaming an id or
 *    mutating v1 in place silently breaks every historical comparison.
 *  - Self-assessment Likert (frequency 1..5), NO right/wrong answer
 *    (§27.2). All items are POSITIVELY keyed (5 = healthiest mindset) — no
 *    reverse-scored items in v1 (short + mobile + weekly-repeated → reverse
 *    wording introduces more method bias than it removes; keeps the pure
 *    aggregator branch-free, SPEC §27.7 risk piece). Reverse-keying is a
 *    possible v2 refinement if straight-lining is observed in admin review.
 *  - Pure data + pure helpers ONLY. No DB, no env, no `server-only` — this
 *    module is consumed by BOTH the server aggregator and the client wizard.
 *  - Dimensions derive from the Mark Douglas framework (SPEC §7.6/§2). No
 *    item gives trade advice or references P&L / Lhedge (posture §2).
 */

export type MindsetDimensionId =
  | 'uncertainty_acceptance'
  | 'ego_result_detachment'
  | 'discipline_plan_adherence'
  | 'emotional_regulation'
  | 'confidence_calibration'
  | 'patience_anti_fomo';

export type LikertValue = 1 | 2 | 3 | 4 | 5;

export interface MindsetLikertAnchor {
  readonly value: LikertValue;
  readonly label: string;
}

export interface MindsetDimension {
  readonly id: MindsetDimensionId;
  /** Short FR label — radar axis. */
  readonly label: string;
  /** One-line FR, strengths-based — reading aid for the member dashboard. */
  readonly description: string;
}

export interface MindsetItem {
  /** Immutable opaque id. NEVER renamed/reused across versions (see header). */
  readonly id: string;
  readonly dimensionId: MindsetDimensionId;
  /** FR statement. Framed by the instrument preamble ("cette semaine"). */
  readonly label: string;
}

export interface MindsetInstrument {
  readonly version: number;
  /** FR member-facing intro: weekly frame + explicit "no right answer". */
  readonly preamble: string;
  /** Exactly 5 anchors, values 1..5 ascending. Shared by every item. */
  readonly likertScale: readonly MindsetLikertAnchor[];
  /** Exactly 6 dimensions (SPEC §27.3). */
  readonly dimensions: readonly MindsetDimension[];
  /** Exactly 12 items, 2 per dimension. */
  readonly items: readonly MindsetItem[];
}

const LIKERT_SCALE_V1: readonly MindsetLikertAnchor[] = [
  { value: 1, label: 'Jamais' },
  { value: 2, label: 'Rarement' },
  { value: 3, label: 'Parfois' },
  { value: 4, label: 'Souvent' },
  { value: 5, label: 'Presque toujours' },
] as const;

const DIMENSIONS_V1: readonly MindsetDimension[] = [
  {
    id: 'uncertainty_acceptance',
    label: "Acceptation de l'incertitude",
    description:
      "Penser en probabilités et accepter qu'aucune issue de trade n'est certaine, même avec une bonne analyse.",
  },
  {
    id: 'ego_result_detachment',
    label: 'Détachement & ego',
    description:
      "Séparer sa valeur personnelle du résultat ; ne pas avoir besoin d'avoir raison contre le marché.",
  },
  {
    id: 'discipline_plan_adherence',
    label: 'Discipline & plan',
    description: "Exécuter le plan défini à l'avance et tenir ses règles, y compris sous pression.",
  },
  {
    id: 'emotional_regulation',
    label: 'Régulation émotionnelle',
    description: "Revenir au calme après un moment difficile ; ne pas laisser l'émotion décider.",
  },
  {
    id: 'confidence_calibration',
    label: 'Confiance calibrée',
    description: 'Une confiance stable, ni écrasée par une perte ni gonflée par un gain.',
  },
  {
    id: 'patience_anti_fomo',
    label: 'Patience & anti-FOMO',
    description: 'Attendre ses conditions ; ne pas poursuivre le marché par peur de rater.',
  },
] as const;

const ITEMS_V1: readonly MindsetItem[] = [
  {
    id: 'd1_i1',
    dimensionId: 'uncertainty_acceptance',
    label:
      "J'ai abordé chaque position en acceptant que son issue était incertaine, même quand mon analyse me semblait solide.",
  },
  {
    id: 'd1_i2',
    dimensionId: 'uncertainty_acceptance',
    label: "J'ai raisonné sur une série de trades plutôt que sur le résultat d'un trade isolé.",
  },
  {
    id: 'd2_i1',
    dimensionId: 'ego_result_detachment',
    label: "Une perte n'a pas entamé ma valeur en tant que personne.",
  },
  {
    id: 'd2_i2',
    dimensionId: 'ego_result_detachment',
    label: "J'ai pu reconnaître une erreur sans avoir besoin d'« avoir raison » contre le marché.",
  },
  {
    id: 'd3_i1',
    dimensionId: 'discipline_plan_adherence',
    label: "J'ai exécuté mes trades conformément au plan que je m'étais fixé à l'avance.",
  },
  {
    id: 'd3_i2',
    dimensionId: 'discipline_plan_adherence',
    label: 'Même après une perte ou pour « me refaire », je ne suis pas sorti de mes règles.',
  },
  {
    id: 'd4_i1',
    dimensionId: 'emotional_regulation',
    label: "Après un moment difficile, j'ai su revenir au calme avant de reprendre.",
  },
  {
    id: 'd4_i2',
    dimensionId: 'emotional_regulation',
    label: "Mes émotions (peur, euphorie, frustration) n'ont pas dicté mes décisions.",
  },
  {
    id: 'd5_i1',
    dimensionId: 'confidence_calibration',
    label: 'Ma confiance est restée stable, ni écrasée par une perte ni gonflée par un gain.',
  },
  {
    id: 'd5_i2',
    dimensionId: 'confidence_calibration',
    label: "Je n'ai pas augmenté ma prise de risque sous l'effet d'une série de gains.",
  },
  {
    id: 'd6_i1',
    dimensionId: 'patience_anti_fomo',
    label: "J'ai attendu mes conditions plutôt que d'entrer par peur de rater.",
  },
  {
    id: 'd6_i2',
    dimensionId: 'patience_anti_fomo',
    label: "Je n'ai pas poursuivi le marché après avoir manqué un mouvement.",
  },
] as const;

export const MINDSET_INSTRUMENT_V1: MindsetInstrument = {
  version: 1,
  preamble:
    "Cette semaine en trading, à quelle fréquence cela t'a correspondu ? Il n'y a pas de bonne ni de mauvaise réponse. C'est un instantané honnête de ton état d'esprit, pour toi et pour ton suivi.",
  likertScale: LIKERT_SCALE_V1,
  dimensions: DIMENSIONS_V1,
  items: ITEMS_V1,
} as const;

/** Every shipped instrument version. Append v2+ here, never mutate v1. */
export const MINDSET_INSTRUMENTS: readonly MindsetInstrument[] = [MINDSET_INSTRUMENT_V1] as const;

export const CURRENT_MINDSET_INSTRUMENT: MindsetInstrument = MINDSET_INSTRUMENT_V1;

export const CURRENT_MINDSET_INSTRUMENT_VERSION = CURRENT_MINDSET_INSTRUMENT.version;

/** Resolve a stored response set's instrument by its persisted version. */
export function getMindsetInstrument(version: number): MindsetInstrument | undefined {
  return MINDSET_INSTRUMENTS.find((instrument) => instrument.version === version);
}

export const MINDSET_LIKERT_MIN: LikertValue = 1;
export const MINDSET_LIKERT_MAX: LikertValue = 5;
