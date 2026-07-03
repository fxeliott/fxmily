import { MICRO_OBJECTIVE_STALE_DAYS } from '@/lib/coaching/micro-objective';

/**
 * Tour 11 (chantier G, FINDING 2 + 4) — PURE age helpers for the admin
 * « Suivi des corrections » panel.
 *
 * The panel showed « ouvert le {date} » with no notion of AGE, so a zombie
 * objective (open for three weeks) was invisible even though it blocks the
 * member's « ≤ 1 open » invariant. These helpers derive a whole-day age and the
 * « stale » predicate the panel uses to surface a calm amber sub-label and, on
 * open rows, the coach's « Renforcer » lever.
 *
 * Zero DB, zero AI : deterministic date math only, so the decision is fully
 * unit-testable (sibling of `coaching/micro-objective.ts::isMicroObjectiveStale`,
 * which we reuse for the threshold to keep ONE source of truth).
 *
 * Posture §31.2 / Mark Douglas : an age is a FACT, never a countdown, never a
 * reproach. The panel renders it in amber (« watch »), never red.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The stale threshold, re-exported so the panel imports it from one place. */
export const CORRECTION_STALE_DAYS = MICRO_OBJECTIVE_STALE_DAYS;

/**
 * Whole days elapsed since `createdAt` (floored). Returns 0 for a same-day row
 * and clamps a future `createdAt` (clock skew) to 0 rather than a negative age
 * that would read as nonsense in the UI.
 */
export function ageDays(createdAt: Date, now: Date = new Date()): number {
  const ms = now.getTime() - createdAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * True when an OPEN objective has aged past {@link CORRECTION_STALE_DAYS} (strict
 * « > 14 j », so a row exactly at the threshold is not yet flagged — the sub-label
 * copy reads « ouvert depuis N j »). Mirrors `isMicroObjectiveStale`'s intent but
 * uses `>` so the day count in the label always exceeds the threshold when shown.
 */
export function isCorrectionStale(createdAt: Date, now: Date = new Date()): boolean {
  return ageDays(createdAt, now) > CORRECTION_STALE_DAYS;
}
