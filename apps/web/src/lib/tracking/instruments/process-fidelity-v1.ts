/**
 * V2 S2 — "Fidélité au cadre" weekly instrument (process-fidelity, v1).
 *
 * The first real instrument of the universal tracking engine. It measures, once
 * a week and calmly, how faithfully the member stuck to the HARD RULES of the
 * méthodo — NOT whether they were profitable. Every item is a discipline /
 * psychology signal drawn from `fxmily app connaissance` (gestion de trades
 * technique) + Mark Douglas:
 *   - coupure totale à 20h, jamais de trade la nuit
 *   - un seul trade à risque par jour, un seul stop-loss par jour
 *   - stop-loss défini AVANT l'entrée
 *   - risque ~0.5% par trade
 *   - break-even au +1R
 *   - préparation faite avant la session (le FAIT, pas le contenu)
 *   - patience / anti-FOMO, pas de revenge après une perte
 *
 * LONGITUDINAL-VALIDITY INVARIANT (non-negotiable, mirror MindsetCheck §27.7):
 * this instrument is STATIC and VERSIONED. Question `id`s are immutable — any
 * wording/scale change ⇒ a NEW version file (process-fidelity-v2.ts), never an
 * edit here. Trends are only ever compared intra-version.
 *
 * POSTURE §2 (BLOQUANT): NOT ONE question references a setup, a direction, a
 * pair, a price level or a forecast. We track THAT the frame was respected,
 * never any market content. `process-fidelity-v1.test.ts` asserts the full
 * concatenated label corpus is clean under `detectAMFViolation`. §31.2: the
 * preamble is explicitly non-punitive — a "non" is a calm signal, never a verdict.
 */

import type { ScaleAnchor, TrackingInstrument } from '../types';

/** Frequency anchors shared by the Likert items (1 = jamais … 5 = presque toujours). */
const FREQUENCY_ANCHORS: readonly ScaleAnchor[] = [
  { value: 1, label: 'Jamais' },
  { value: 2, label: 'Rarement' },
  { value: 3, label: 'Parfois' },
  { value: 4, label: 'Souvent' },
  { value: 5, label: 'Presque toujours' },
] as const;

export const PROCESS_FIDELITY_V1: TrackingInstrument = {
  key: 'process-fidelity',
  version: 'v1',
  axis: 'risk_discipline',
  title: 'Fidélité à ton cadre',
  preamble:
    "Repense à ta semaine de trading. Pour chaque règle de ton cadre, indique honnêtement si tu l'as tenue. " +
    "Il n'y a pas de bonne ni de mauvaise réponse : un « non » n'est pas un échec, juste un repère pour toi et ton suivi.",
  cadence: { kind: 'weekly', anchorDow: 1 },
  defaultCaptureContext: 'cold',
  capturesConfidence: true,
  questions: [
    {
      id: 'cut_20h',
      kind: 'boolean',
      label: 'Cette semaine, as-tu respecté ta coupure : aucun trading après 20h, jamais la nuit ?',
    },
    {
      id: 'one_risk_trade_per_day',
      kind: 'boolean',
      label: "As-tu tenu ta règle d'un seul trade à risque par jour ?",
    },
    {
      id: 'one_stop_per_day',
      kind: 'boolean',
      label: "As-tu tenu ta règle d'un seul arrêt par jour ?",
      help: "Une seule perte sèche encaissée puis on s'arrête pour la journée.",
    },
    {
      id: 'stop_set_before_entry',
      kind: 'boolean',
      label: "Avant chaque entrée, ton niveau de sortie de protection était-il défini à l'avance ?",
    },
    {
      id: 'risk_size_respected',
      kind: 'boolean',
      label: 'As-tu gardé ton risque par position à la taille prévue par ton plan ?',
    },
    {
      id: 'breakeven_secured',
      kind: 'boolean',
      label: 'Quand un trade a bien évolué, as-tu sécurisé ta position comme prévu dans ton plan ?',
      required: false,
    },
    {
      id: 'prep_done_before_session',
      kind: 'boolean',
      label: 'As-tu fait ta préparation avant la session, sans te juger sur le résultat ?',
      help: 'On note seulement que la préparation a eu lieu, pas son contenu.',
    },
    {
      id: 'patience_anti_fomo',
      kind: 'likert',
      label:
        "À quelle fréquence as-tu attendu tes conditions plutôt que d'entrer par peur de rater ?",
      anchors: FREQUENCY_ANCHORS,
    },
    {
      id: 'no_revenge_after_loss',
      kind: 'likert',
      label:
        'Après une perte, à quelle fréquence es-tu resté dans tes règles, sans chercher à te refaire ?',
      anchors: FREQUENCY_ANCHORS,
    },
    {
      id: 'felt_emotion',
      kind: 'single_choice',
      label: 'Quelle émotion a le plus marqué ta semaine de trading ?',
      required: false,
      options: [
        { value: 'calm', label: 'Calme' },
        { value: 'confident', label: 'Confiant' },
        { value: 'impatient', label: 'Impatient' },
        { value: 'fearful', label: 'Peur' },
        { value: 'frustrated', label: 'Frustré' },
        { value: 'euphoric', label: 'Euphorique' },
      ],
    },
  ],
} as const;
