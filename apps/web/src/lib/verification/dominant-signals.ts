import type { ScoreEventView } from './constancy';

/**
 * S4 (CONTEXTE GLOBAL « Scoring ») — « chaque score affiche les 2-3 signaux qui
 * l'ont fait bouger ». The score-events feed lists EVERY recent event 1:1, which
 * is honest but doesn't answer the member's first question : « qu'est-ce qui a le
 * plus compté ? ». This pure helper folds the feed into the few dominant signals
 * so the surface can lead with them.
 *
 * Pure (no DB, no server-only) → unit-tested in isolation. Type-only import of
 * `ScoreEventView` is erased at compile time, so `constancy.ts`'s `server-only`
 * guard is never pulled into a node test.
 *
 * Posture §2 / §33.2 : a factual fold of the member's OWN events, never a verdict
 * — the dominance is severity × frequency, the surface that renders it stays calm
 * (no punitive red), exactly like the per-event `IMPACT` labels it summarizes.
 */

export type SignalReason = ScoreEventView['reason'];

export interface DominantSignal {
  readonly reason: SignalReason;
  /** « up » lifts the score (filled), « down » weighs on it. */
  readonly direction: 'up' | 'down';
  /** How many non-excused events of this reason landed in the window. */
  readonly count: number;
}

/** Relative weight per reason — mirrors `ScoreEventsHistory`'s IMPACT ordering. */
const SEVERITY: Record<SignalReason, number> = {
  false_declaration: 4,
  reality_gap: 3,
  forgot_no_reason: 2,
  filled: 1,
};

const DIRECTION: Record<SignalReason, 'up' | 'down'> = {
  filled: 'up',
  forgot_no_reason: 'down',
  reality_gap: 'down',
  false_declaration: 'down',
};

/**
 * The 2-3 reasons that moved the score most, ranked by severity × frequency.
 *
 * EXCUSED events are skipped : a neutralized event (motif donné, ou levé par la
 * réalité) did NOT move the score, so it can't be a « signal qui l'a fait bouger »
 * — surfacing it would contradict the feed that strikes it through.
 */
export function pickDominantSignals(events: readonly ScoreEventView[], max = 3): DominantSignal[] {
  const counts = new Map<SignalReason, number>();
  for (const e of events) {
    if (e.excused) continue;
    counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, direction: DIRECTION[reason] }))
    .sort((a, b) => {
      const wa = SEVERITY[a.reason] * a.count;
      const wb = SEVERITY[b.reason] * b.count;
      if (wb !== wa) return wb - wa;
      if (b.count !== a.count) return b.count - a.count;
      return SEVERITY[b.reason] - SEVERITY[a.reason];
    })
    .slice(0, Math.max(0, max));
}
