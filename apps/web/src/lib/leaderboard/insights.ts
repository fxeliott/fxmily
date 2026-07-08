/**
 * Derived member INSIGHTS from a leaderboard score — pure, no I/O, unit-tested.
 *
 * Two read-time signals the ranking already contains but never surfaced, so the
 * board can speak to each member individually instead of with one generic line:
 *
 *   - `weakestPillar` — the lever with the most room to grow, so the card tells
 *     the member EXACTLY what to push to climb ("adapté pour chaque membre").
 *   - `isLowScore`    — a genuinely low composite, so a member who is not doing
 *     the work gets a calm, actionable nudge (never punitive, never P&L-red).
 *
 * Both derive from the SAME persisted `LeaderboardScore` the card already holds
 * (`me.breakdown`) — zero extra query, zero migration. 🔒 Neither ever reads the
 * `consistency` (P&L) dimension: they operate on the four ACT pillars only.
 */

import type { LeaderboardParts } from './types';

/** The four pillars in their canonical display order — also the deterministic
 *  tie-break order for {@link weakestPillar} (assiduité first). */
export const PILLAR_ORDER = ['assiduity', 'discipline', 'regularity', 'work'] as const;

export type PillarKey = (typeof PILLAR_ORDER)[number];

/**
 * The member's weakest ACTIVE pillar — the non-null pillar with the lowest fill
 * `rate`, i.e. where they have the most upside to climb. Ties break by
 * {@link PILLAR_ORDER} (assiduité wins) so the result is deterministic. Returns
 * `null` when every pillar is null (an unranked member has no lever to push
 * yet). A non-finite rate is skipped defensively (never poisons the min).
 */
export function weakestPillar(parts: LeaderboardParts): PillarKey | null {
  let best: { key: PillarKey; rate: number } | null = null;
  for (const key of PILLAR_ORDER) {
    const part = parts[key];
    if (part === null || !Number.isFinite(part.rate)) continue;
    // Strict `<` keeps the FIRST pillar on a tie → respects PILLAR_ORDER.
    if (best === null || part.rate < best.rate) {
      best = { key, rate: part.rate };
    }
  }
  return best?.key ?? null;
}

/**
 * Composite (0–100) strictly below which a RANKED member is gently flagged
 * "score bas". Tuned to catch a member genuinely not doing the work without
 * false-alarming a mid-table member (a ~50 % check-in rate lands near 50). A
 * named constant so it stays a single, tunable source of truth for both the
 * member card and the admin surface. NOT a P&L threshold — the composite is the
 * ACT-of-working score, so the alert is ambre (`--warn`), never red (`--bad`).
 */
export const LOW_SCORE_THRESHOLD = 40;

/**
 * Is this a genuinely low, ACTIONABLE score? Only for a RANKED member (`status
 * 'ok'` with a real number): an `insufficient_data` member has no score to be
 * "low" — they get the warm "presque au classement" path, never an alert.
 */
export function isLowScore(score: number | null, status: 'ok' | 'insufficient_data'): boolean {
  return status === 'ok' && score !== null && Number.isFinite(score) && score < LOW_SCORE_THRESHOLD;
}
