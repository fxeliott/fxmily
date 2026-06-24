/**
 * V2 S2 — Universal tracking taxonomy (the 11-axis méthodo surface, FR labels).
 *
 * PURE data + pure helpers ONLY. No DB, no env, no `server-only` — this module
 * is consumed by BOTH the server service and the client wizard (mirror
 * `lib/mindset/instrument.ts`). The axis ids are the runtime contract: they
 * MUST stay in lock-step with the Prisma `TrackingAxis` enum. The
 * `satisfies Record<TrackingAxis, …>` assertion below makes any drift a
 * COMPILE error — add a Prisma enum value ⇒ this file must gain its label, and
 * vice-versa (longitudinal contract, no silent gap).
 *
 * POSTURE §2: every axis is a PROCESS / behavioural dimension. "market_analysis"
 * tracks THAT the prep happened (a discipline signal), NEVER its CONTENT — the
 * same posture as `DailyCheckin.marketAnalysisDone`. No axis is a P&L surface.
 *
 * Coverage of the méthodo (DoD case 5, ZERO loss): exécution, gestion du risque
 * (1 trade/1 SL/jour, 0.5%, R:R, BE au R1), analyse (préparation), entraînement
 * (backtest §21), la formation suivie, réunions §30, émotions + confiance
 * (avant/pendant/après), sommeil & hygiène de vie, bilan du soir, travail sur
 * soi (mindset Mark Douglas), routine.
 */

import type { TrackingAxis } from '@/generated/prisma/enums';

export type TrackingAxisId = TrackingAxis;

export interface TrackingAxisMeta {
  /** Immutable id — mirrors the Prisma `TrackingAxis` enum value. */
  readonly id: TrackingAxisId;
  /** Short FR label (dashboard gauge / chip). */
  readonly label: string;
  /** One-line FR, strengths-based reading aid. */
  readonly description: string;
}

/**
 * Canonical axis metadata. Keyed map (not array) so the parity assertion below
 * can prove every Prisma enum value has exactly one entry — no missing axis,
 * no orphan label.
 */
const AXIS_META = {
  execution: {
    id: 'execution',
    label: 'Exécution',
    description: "Passer à l'action sur le marché en respectant son process, sans précipitation.",
  },
  risk_discipline: {
    id: 'risk_discipline',
    label: 'Gestion du risque',
    description:
      'Tenir ses règles dures : un seul trade à risque par jour, un seul stop, risque maîtrisé, stop défini avant.',
  },
  market_analysis: {
    id: 'market_analysis',
    label: 'Préparation / analyse',
    description: 'Faire sa préparation avant la session — le fait que la préparation a eu lieu.',
  },
  training: {
    id: 'training',
    label: 'Entraînement',
    description: "Le travail de backtest et d'entraînement hors marché réel.",
  },
  formation: {
    id: 'formation',
    label: 'Formation',
    description: 'Suivre et avancer dans la formation — le fait de continuer à se former.',
  },
  meeting_presence: {
    id: 'meeting_presence',
    label: 'Réunions',
    description: 'La présence et la régularité aux réunions de groupe.',
  },
  emotions_confidence: {
    id: 'emotions_confidence',
    label: 'Émotions & confiance',
    description: "L'état émotionnel et le niveau de confiance, avant, pendant et après l'action.",
  },
  sleep_lifestyle: {
    id: 'sleep_lifestyle',
    label: 'Sommeil & hygiène',
    description: 'Le sommeil et les habitudes de vie qui soutiennent la performance mentale.',
  },
  evening_review: {
    id: 'evening_review',
    label: 'Bilan du soir',
    description: 'Le retour calme sur la journée — ce qui a été tenu, ce qui peut progresser.',
  },
  self_work: {
    id: 'self_work',
    label: 'Travail sur soi',
    description: "Le travail d'état d'esprit Mark Douglas : acceptation, détachement, patience.",
  },
  routine: {
    id: 'routine',
    label: 'Routine',
    description: 'Les rituels personnels qui cadrent la journée de trading.',
  },
} as const satisfies Record<TrackingAxis, TrackingAxisMeta>;

/** Every axis, in canonical display order. */
export const TRACKING_AXES: readonly TrackingAxisMeta[] = Object.values(AXIS_META);

/** All axis ids (handy for iteration / validation). */
export const TRACKING_AXIS_IDS: readonly TrackingAxisId[] = TRACKING_AXES.map((a) => a.id);

/** Resolve an axis' metadata. Returns `undefined` for an unknown id. */
export function getAxisMeta(id: TrackingAxisId): TrackingAxisMeta | undefined {
  return AXIS_META[id];
}

/** FR label for an axis, falling back to the raw id (never throws). */
export function getAxisLabel(id: TrackingAxisId): string {
  return AXIS_META[id]?.label ?? id;
}
