/**
 * S7 §33-#1 — ready-to-use admin comment presets (the "palette de commentaires").
 *
 * A curated, reusable palette of *coaching* reframes the admin (Eliott) can drop
 * into a trade / backtest correction in one tap, then personalise. Goal: faster,
 * more regular, more memorable corrections for the member.
 *
 * 🚨 GARDE-FOU §2 (non négociable) — these phrases are STRICTLY psychological /
 * discipline / execution-respect, in the Mark Douglas register. They NEVER carry
 * trade-analysis advice (no direction, price level, trend, setup validity call).
 * `comment-presets.test.ts` enforces this with a forbidden-token scan, so a future
 * edit that smuggles analysis in fails CI rather than reaching a member.
 *
 * Pure data (no `server-only`, no DB) → shared by the two annotation Sheets
 * (`annotate-trade-button`, `annotate-training-trade-button`) and unit-testable.
 */

export type CommentPresetGroupId = 'plan' | 'process' | 'emotion' | 'ego' | 'routine' | 'patience';

export interface CommentPreset {
  /** Stable id (used as React key + e2e selector). */
  id: string;
  /** Short chip label shown in the palette. */
  label: string;
  /** Full coaching phrase inserted into the comment field. */
  text: string;
}

export interface CommentPresetGroup {
  id: CommentPresetGroupId;
  /** Section heading in the palette. */
  label: string;
  presets: readonly CommentPreset[];
}

/**
 * The palette, grouped by coaching theme. Sober and concrete — every phrase
 * serves the member's discipline/mindset, none judges the market read.
 */
export const COMMENT_PRESET_GROUPS: readonly CommentPresetGroup[] = [
  {
    id: 'plan',
    label: 'Discipline & plan',
    presets: [
      {
        id: 'plan-respected',
        label: 'Plan respecté',
        text: 'Tu as suivi ton plan de bout en bout. C’est exactement la régularité qu’on construit. Continue ainsi.',
      },
      {
        id: 'plan-deviation',
        label: 'Écart au plan',
        text: 'Ici l’exécution s’est écartée de ton plan. Reviens à ta règle écrite : la discipline se gagne un trade à la fois, sans te juger.',
      },
      {
        id: 'system-not-respected',
        label: 'Système non respecté',
        text: 'Le système n’a pas été respecté sur ce trade. Reviens à la règle plutôt qu’à l’intuition. C’est elle qui te protège dans la durée.',
      },
    ],
  },
  {
    id: 'process',
    label: 'Process > résultat',
    presets: [
      {
        id: 'process-over-outcome',
        label: 'Process > résultat',
        text: 'Bon process, peu importe l’issue : un trade gagnant mal exécuté reste un mauvais trade, un trade perdant bien exécuté reste un bon trade (Mark Douglas).',
      },
      {
        id: 'one-probability',
        label: 'Un trade = une probabilité',
        text: 'Chaque trade n’est qu’une probabilité parmi une série. Détache-toi de l’issue d’un trade isolé, concentre-toi sur la qualité de ta série.',
      },
    ],
  },
  {
    id: 'emotion',
    label: 'Émotions & mental',
    presets: [
      {
        id: 'emotion-awareness',
        label: 'Gestion émotionnelle',
        text: 'Note ce que tu ressentais avant d’entrer : l’émotion précède presque toujours l’erreur. La nommer, c’est déjà reprendre le contrôle.',
      },
      {
        id: 'after-loss',
        label: 'Après une perte',
        text: 'Après une perte, l’objectif n’est pas de te refaire : c’est d’exécuter proprement le trade suivant. Pas de revanche à prendre.',
      },
      {
        id: 'fomo',
        label: 'FOMO',
        text: 'Tu sembles être entré par peur de manquer (FOMO). Il y aura toujours une autre opportunité. Attendre n’est pas perdre.',
      },
    ],
  },
  {
    id: 'ego',
    label: 'Ego & sur-confiance',
    presets: [
      {
        id: 'overconfidence',
        label: 'Sur-confiance',
        text: 'Attention au sizing après une série de gains : « l’arrogance précède la chute » (Mark Douglas). Garde une taille de position constante, fidèle à ton plan.',
      },
      {
        id: 'nothing-to-prove',
        label: 'Rien à prouver',
        text: 'Tu n’as rien à prouver. Le but n’est pas d’avoir raison, c’est d’exécuter ton process avec constance.',
      },
    ],
  },
  {
    id: 'routine',
    label: 'Routine & hygiène',
    presets: [
      {
        id: 'evening-review',
        label: 'Bilan du soir',
        text: 'Ton bilan du soir manque ici. C’est lui qui transforme l’expérience en compétence. Prends cinq minutes pour le poser à chaud.',
      },
      {
        id: 'sleep-routine',
        label: 'Sommeil & routine',
        text: 'Ta lucidité en séance se joue avant : sommeil, routine du matin, état d’esprit. Soigne l’amont, l’exécution suivra.',
      },
    ],
  },
  {
    id: 'patience',
    label: 'Patience & exécution',
    presets: [
      {
        id: 'execution-patience',
        label: 'Patience d’exécution',
        text: 'Entrée anticipée avant ta confirmation. Travaille la patience d’attendre TON moment. Souvent, la meilleure action est de ne rien faire.',
      },
      {
        id: 'let-it-run',
        label: 'Laisser courir le plan',
        text: 'Tu as laissé le trade se dérouler selon ton plan, sans intervenir sous l’émotion. Excellente maîtrise d’exécution. Reproduis-la.',
      },
    ],
  },
];

/** Flat list of every preset (handy for tests + count assertions). */
export const ALL_COMMENT_PRESETS: readonly CommentPreset[] = COMMENT_PRESET_GROUPS.flatMap(
  (g) => g.presets,
);
