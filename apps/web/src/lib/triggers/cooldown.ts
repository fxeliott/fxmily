/**
 * Cooldown logic for Mark Douglas card deliveries (J7).
 *
 * The cooldown layer prevents push spam — even if a user keeps matching the
 * same trigger, we hold off resending for `cooldownDays`. This is the
 * "mercy infrastructure" Yu-kai Chou recommends in *Actionable Gamification*
 * (ch. 14): users need space to integrate before another nudge of the same
 * type.
 *
 * Two surfaces:
 *   - `isOnCooldown(...)`: pure, takes a delivery history slice → bool.
 *   - `pickBestMatch(...)`: pure, sorts matched cards by priority desc and
 *     filters out the ones on cooldown. Returns 0 or 1 candidate (anti-spam:
 *     1 card per evaluation tick).
 *
 * Both are test-friendly without Prisma. The DB call to fetch the history
 * lives in `engine.ts` (single trip per user).
 */

import { COOLDOWN_DAYS_BY_HAT, type HatClass } from './types';

/**
 * Past delivery slim shape — what `isOnCooldown` needs.
 * Decoupled from Prisma so tests don't import the client.
 */
export interface DeliveryHistoryEntry {
  cardId: string;
  /** Most recent createdAt (ms epoch). */
  createdAtMs: number;
}

// =============================================================================
// Routine-cadence adaptive spacing (TASK C — §26 "tout s'adapte")
// =============================================================================

/**
 * Engagement-history slim shape for the routine-saturation check. A ROUTINE
 * delivery is a classic J7-evaluator card (`sourceAlertId === null`); an ALERTE
 * delivery (S3 constancy engine, `sourceAlertId !== null`) is NEVER counted here
 * and is never spaced — drift alerts must always go out (invariant S3).
 * `seenAtMs === null` means the member never opened that routine card.
 */
export interface RoutineEngagementEntry {
  /** createdAt (ms epoch). Used only to take the K most-recent. */
  createdAtMs: number;
  /** seenAt as ms epoch, or `null` if the member never opened it.
   *  NOTE: `seenAt` is ALSO stamped on DISMISS (`markDeliveryDismissed`,
   *  `cards/service.ts`), so "seen" here includes "dismissed/rejected" — a
   *  dismissed routine card counts as engaged-with and so does NOT contribute
   *  to saturation. This is DELIBERATELY conservative: we err toward DELIVERING
   *  the next routine nudge, never toward wrongly suppressing it. */
  seenAtMs: number | null;
  /** `true` ⇔ classic evaluator delivery (`sourceAlertId === null`). */
  isRoutine: boolean;
}

/**
 * How many trailing ROUTINE deliveries must ALL be unseen before we space the
 * cadence. K=3 is deliberately conservative: a saturated member is one who has
 * ignored their last three routine nudges in a row. Tunable later per SPEC §26.
 */
export const ROUTINE_SATURATION_K = 3;

/**
 * TASK C — adaptive routine cadence (CONSERVATIVE, reversible).
 *
 * Returns `true` when the member is "saturated" on routine cards: the
 * `k` most-recent ROUTINE deliveries (sourceAlertId === null) ALL have
 * `seenAtMs === null` (never opened). When saturated, the engine spaces the
 * routine cadence by skipping today's routine fiche — the member is clearly
 * not engaging, so another nudge of the same kind only adds noise (Yu-kai Chou
 * "mercy infrastructure", same rationale as `isOnCooldown`).
 *
 * **OFF-equivalent gate (anti-regression)**: if the member has FEWER than `k`
 * routine deliveries in history, this returns `false` → the engine behaves
 * exactly as before (new members and lightly-served members are never spaced).
 * This is the single most conservative design: it only ever *removes* a routine
 * push for a demonstrably-disengaged member, never adds one, never touches the
 * ≤1-fiche/day cap, the hatClass cooldown, or any ALERTE delivery.
 *
 * Pure — no DB, no clock dependency beyond the pre-extracted ms fields. The
 * tradeoff is intentionally one-directional and trivially reversible: delete
 * the single call site in `engine.ts` to restore byte-identical old behaviour.
 */
export function isRoutineSaturated(
  history: RoutineEngagementEntry[],
  k: number = ROUTINE_SATURATION_K,
): boolean {
  if (k <= 0) return false;
  const routine = history.filter((h) => h.isRoutine).sort((a, b) => b.createdAtMs - a.createdAtMs);
  // OFF-equivalent: insufficient routine history → current behaviour.
  if (routine.length < k) return false;
  // All of the K most-recent routine deliveries unseen ⇒ saturated.
  return routine.slice(0, k).every((h) => h.seenAtMs === null);
}

/**
 * Returns true if `cardId` was delivered to the user within the cooldown
 * window for its hat class. The window length is `COOLDOWN_DAYS_BY_HAT[hat]`
 * — 7 days for white, 14 for black.
 *
 * `now` is injectable for testability. `history` should already be filtered
 * to the relevant user — we don't filter here.
 */
export function isOnCooldown(
  cardId: string,
  hatClass: HatClass,
  history: DeliveryHistoryEntry[],
  now: Date,
): boolean {
  const cooldownDays = COOLDOWN_DAYS_BY_HAT[hatClass];
  const cutoffMs = now.getTime() - cooldownDays * 24 * 3600 * 1000;
  for (const h of history) {
    if (h.cardId === cardId && h.createdAtMs >= cutoffMs) return true;
  }
  return false;
}

// =============================================================================
// pickBestMatch — choose 1 card per evaluation tick
// =============================================================================

/** Slim card shape used by the picker. */
export interface PickerCard {
  id: string;
  priority: number;
  hatClass: HatClass;
}

export interface PickerInput {
  matched: PickerCard[];
  history: DeliveryHistoryEntry[];
  now: Date;
}

export interface PickedCard {
  cardId: string;
}

/**
 * Pick the best-matching card eligible for delivery:
 *   1. Drop cards on cooldown.
 *   2. Sort remaining by `priority DESC` (ties broken by `id` ASC for
 *      determinism).
 *   3. Return the head, or `null` if nothing eligible.
 *
 * Pure — no DB, no clock. Engine layer handles persistence.
 */
export function pickBestMatch(input: PickerInput): PickedCard | null {
  const eligible = input.matched.filter(
    (c) => !isOnCooldown(c.id, c.hatClass, input.history, input.now),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { cardId: eligible[0]!.id };
}
