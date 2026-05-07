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
