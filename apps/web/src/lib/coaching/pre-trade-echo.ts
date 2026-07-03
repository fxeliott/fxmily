import type { PreTradeEmotion, PreTradeReason } from '@/lib/schemas/pre-trade-check';

import type { CoachingRegister } from './trade-echo';

/**
 * Tour 11 — the LIVING pre-trade echo. The pre-trade "pause de discipline" is
 * the circuit breaker fired the instant BEFORE a trade (reason, emotion, plan
 * alignment, stop-loss predefined). Until now, submitting it redirected to
 * `/dashboard?done=pre-trade` where the param was DEAD: zero acknowledgement,
 * the pause fell into the void. This module answers the ACT: a short,
 * member-specific reading of what the member just declared, so the 30s pause
 * lands somewhere.
 *
 * Sibling of `trade-echo.ts` / `checkin-echo.ts` — same shape, same posture,
 * same deterministic decision-table pattern. Pure module (no `server-only`,
 * no DB) so the table is unit-testable.
 *
 * DETERMINISTIC, ZERO AI CALL: every sentence is FIXED French copy selected by
 * enum/boolean rules (reasonToTrade, emotionLabel, planAlignment,
 * stopLossPredefined, coachingRegister). No raw AI text surfaced → no AI Act
 * banner.
 *
 * POSTURE §2 / §31.2 / Mark Douglas: the pause is a MIRROR, never a barrier and
 * never a verdict. A soft signal (unaligned plan, no stop, fomo/revenge/anxious
 * entry) renders tone 'watch' (accent, calm), never red. A fully aligned pause
 * renders tone 'ok' as brief reinforcement. We NEVER tell the member not to
 * trade — the choice stays theirs (ADR-003 no-hard-block). French copy, simple
 * punctuation, no em-dash.
 */

export interface PreTradeEchoInput {
  reasonToTrade: PreTradeReason;
  emotionLabel: PreTradeEmotion;
  planAlignment: boolean;
  stopLossPredefined: boolean;
  coachingRegister: CoachingRegister | null;
}

export interface PreTradeEcho {
  title: string;
  /** Drives the card accent only — 'watch' stays calm (accent, never red). */
  tone: 'ok' | 'watch';
  /** 1 to 2 short sentences. */
  lines: string[];
}

/** Per-register copy for one signal. Register picked from coachingTone. */
type RegisterCopy = Record<CoachingRegister, string>;

/** Reasons that flag a fear-driven / non-edge entry (ADR-003 Douglas mapping). */
const NON_EDGE_REASONS: ReadonlySet<PreTradeReason> = new Set<PreTradeReason>([
  'fomo',
  'revenge',
  'boredom',
]);
/** Affective states that flag a charged entry (Russell grid negative valence). */
const CHARGED_EMOTIONS: ReadonlySet<PreTradeEmotion> = new Set<PreTradeEmotion>([
  'frustre',
  'anxieux',
]);

// =============================================================================
// Copy — priority order, FIRST match wins (one mirror, never a stack).
// =============================================================================

const NO_STOP: RegisterCopy = {
  direct:
    "Pas de stop-loss défini avant d'entrer. C'est le seul filet qui te protège quand le marché décide : pose-le d'abord.",
  pedagogique:
    "Tu entres sans stop-loss prédéfini. Le stop décidé à froid, avant l'entrée, est ce qui t'évite de le déplacer sous le coup de l'émotion : c'est ta protection.",
  socratique:
    "Pas de stop-loss défini pour l'instant. Où le placerais-tu, et qu'est-ce qui t'empêche de le fixer maintenant ?",
};

const PLAN_UNALIGNED: RegisterCopy = {
  direct:
    "Ce trade n'est pas aligné à ton plan. La pause a fait son travail en te le montrant : à toi de décider en conscience.",
  pedagogique:
    "Tu notes que ce trade n'est pas aligné à ton plan. Le voir avant d'entrer, c'est déjà reprendre la main : un trade hors plan reste possible, mais il n'est plus automatique.",
  socratique:
    "Ce trade n'est pas aligné à ton plan. Qu'est-ce qui te pousse à le prendre quand même, ton edge ou autre chose ?",
};

const NON_EDGE_REASON: RegisterCopy = {
  direct:
    "Tu entres pour une autre raison que ton edge. Nomme-la, c'est déjà repris le contrôle sur elle.",
  pedagogique:
    "La raison que tu donnes n'est pas ton edge. La reconnaître à froid, avant d'entrer, c'est ce qui t'évite qu'elle décide à ta place.",
  socratique:
    "Tu entres pour une autre raison que ton edge. Est-ce que ce trade existerait encore si cette raison n'était pas là ?",
};

const CHARGED_ENTRY: RegisterCopy = {
  direct:
    'Tu entres dans un état chargé émotionnellement. Respire un instant : la pause est là pour ça.',
  pedagogique:
    "Tu notes un état émotionnel chargé avant d'entrer. Le reconnaître maintenant réduit le risque qu'il pilote ton exécution sans que tu le voies.",
  socratique:
    "Tu entres dans un état chargé. Qu'est-ce que cette émotion cherche à te faire faire, et est-ce dans ton plan ?",
};

/** All-green reinforcement — brief, calm, never triumphant. */
const ALIGNED: RegisterCopy = {
  direct: 'Entrée alignée, stop défini, tête posée. Exécute ton plan, rien à forcer.',
  pedagogique:
    "Plan aligné, stop prédéfini, état posé : tu entres dans les conditions de ton process. C'est exactement ce qui rend un trade répétable.",
  socratique:
    'Tout est aligné : plan, stop, état. Comment reproduire ces conditions au prochain trade ?',
};

/**
 * Build the pre-trade echo. Never returns null: the check was just submitted,
 * so there is always a reading. `watch` priority: a missing stop is the most
 * consequential signal, then an unaligned plan, then a non-edge reason, then a
 * charged emotional state. Fully aligned → single reinforcement line.
 */
export function buildPreTradeEcho(input: PreTradeEchoInput): PreTradeEcho {
  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  const noStop = input.stopLossPredefined === false;
  const unaligned = input.planAlignment === false;
  const nonEdge = NON_EDGE_REASONS.has(input.reasonToTrade);
  const charged = CHARGED_EMOTIONS.has(input.emotionLabel);

  if (noStop) {
    return { title: 'Ta pause, avant d’entrer', tone: 'watch', lines: [NO_STOP[register]] };
  }
  if (unaligned) {
    return {
      title: 'Ta pause, avant d’entrer',
      tone: 'watch',
      lines: [PLAN_UNALIGNED[register]],
    };
  }
  if (nonEdge) {
    return {
      title: 'Ta pause, avant d’entrer',
      tone: 'watch',
      lines: [NON_EDGE_REASON[register]],
    };
  }
  if (charged) {
    return {
      title: 'Ta pause, avant d’entrer',
      tone: 'watch',
      lines: [CHARGED_ENTRY[register]],
    };
  }

  return { title: 'Ta pause, avant d’entrer', tone: 'ok', lines: [ALIGNED[register]] };
}
