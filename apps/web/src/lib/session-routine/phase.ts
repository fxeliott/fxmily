/**
 * Session 24 — Journée-type trader : pure session-phase derivation (no DB, no
 * env, no `server-only`). Imported by the session-routine service AND the unit
 * test. The single source of truth for the canonical Fxmily/Eliott trading day.
 *
 * THE METHOD'S CLOCK (heure de Paris, fixe pour toute la cohorte — c'est la
 * session de New York lue en heure française, identique pour chaque membre) :
 *   < 12h        → `before`      : préparation, zéro position, on attend la session.
 *   12h – 13h    → `analysis`    : analyse multi-timeframe (Daily → H1 → M15). Aucune exécution.
 *   13h – 16h    → `execution`   : fenêtre d'exécution (le momentum d'open). 1 trade/jour.
 *   16h – 20h    → `management`  : gestion (BE, laisser courir, ne rien forcer).
 *   ≥ 20h        → `closed`      : coupure totale. La nuit n'est pas la session.
 *
 * Mirrors the anti-flake invariant of `lib/daily-guidance/slot.ts` : the
 * wall-clock hour is read in the IANA timezone via `Intl.DateTimeFormat`, NEVER
 * via `Date.getHours()` on a naive instant (DST-safe). We reuse `localHour`
 * from that module — single implementation, single tested seam.
 *
 * POSTURE §2 (BLOQUANT) + anti-Black-Hat (§31.2). This module carries ONLY the
 * PROCESS/discipline rhythm of the method — never a market call. The copy never
 * says "entre / vends" ; the execution window line is explicitly conditional on
 * the member's OWN process being complete ("l'attente est une position"). No
 * countdown, no urgency, no red — a calm hour-by-hour anchor.
 */

import { localHour } from '@/lib/daily-guidance/slot';

export type SessionPhase = 'before' | 'analysis' | 'execution' | 'management' | 'closed';

/** Paris wall-clock boundaries of the method's day. before < 12 ≤ analysis < 13 ≤ execution < 16 ≤ management < 20 ≤ closed. */
const ANALYSIS_FROM_HOUR = 12;
const EXECUTION_FROM_HOUR = 13;
const MANAGEMENT_FROM_HOUR = 16;
const CLOSED_FROM_HOUR = 20;

/**
 * The current session phase for `instant`. Anchored on Europe/Paris by default
 * because the method's hours ARE Paris hours (the NY session read in heure
 * française) — the same schedule for every member, not the member's local clock.
 */
export function currentSessionPhase(
  instant: Date,
  timezone: string = 'Europe/Paris',
): SessionPhase {
  const h = localHour(instant, timezone);
  if (h < ANALYSIS_FROM_HOUR) return 'before';
  if (h < EXECUTION_FROM_HOUR) return 'analysis';
  if (h < MANAGEMENT_FROM_HOUR) return 'execution';
  if (h < CLOSED_FROM_HOUR) return 'management';
  return 'closed';
}

/** The four ACTIVE steps of the trading day, in order, for the timeline UI. */
export const SESSION_STEPS = [
  { phase: 'analysis', label: 'Analyse', window: '12h-13h' },
  { phase: 'execution', label: 'Exécution', window: '13h-16h' },
  { phase: 'management', label: 'Gestion', window: '16h-20h' },
  { phase: 'closed', label: 'Coupure', window: '20h' },
] as const satisfies ReadonlyArray<{ phase: SessionPhase; label: string; window: string }>;

/**
 * Index of `phase` among `SESSION_STEPS` (0..3), or `-1` for `before` (the day
 * hasn't opened yet — no step is active, the timeline shows all four as pending).
 */
export function sessionStepIndex(phase: SessionPhase): number {
  return SESSION_STEPS.findIndex((s) => s.phase === phase);
}

export interface SessionPhaseGuidance {
  /** Short calm headline ("Fenêtre d'exécution"). */
  headline: string;
  /** One calm process sentence — discipline/psychology only, never a market call. */
  line: string;
}

/**
 * The calm, method-faithful process message for each phase. Every line is
 * PROCESS/discipline/psychology (posture §2-safe) — it tells the member what
 * MOMENT of their own routine it is, never what the market will do.
 */
export function sessionPhaseGuidance(phase: SessionPhase): SessionPhaseGuidance {
  switch (phase) {
    case 'before':
      return {
        headline: 'Avant la session',
        line: 'La session de New York s’ouvre à 12h. Tu démarres à zéro position : prépare ton mental, pas encore le marché.',
      };
    case 'analysis':
      return {
        headline: 'Moment d’analyse',
        line: 'Pose ton analyse multi-timeframe, du large au précis (Daily → H1 → M15). On observe et on définit. Aucune exécution maintenant.',
      };
    case 'execution':
      return {
        headline: 'Fenêtre d’exécution',
        line: 'Si, et seulement si, ton process est complet, c’est ici que tu exécutes ton plan. Sinon, pas de trade : l’attente est une position.',
      };
    case 'management':
      return {
        headline: 'Gestion',
        line: 'Tu laisses courir, tu sécurises (BE), tu ne forces rien. Un trade par jour suffit. La patience fait partie du plan.',
      };
    case 'closed':
      return {
        headline: 'Coupure',
        line: 'Après 20h, on coupe tout, quel que soit le résultat. La nuit n’est pas ta session. Demain repart à zéro.',
      };
  }
}
