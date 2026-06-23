import 'server-only';

import { localDateOf } from '@/lib/checkin/timezone';
import { localHour } from '@/lib/daily-guidance/slot';
import { db } from '@/lib/db';

import {
  currentSessionPhase,
  sessionPhaseGuidance,
  type SessionPhase,
  type SessionPhaseGuidance,
} from './phase';

/**
 * Session 24 — Journée-type trader : the READ-ONLY day-status derivation for the
 * dashboard SessionTimeline. Combines the pure time-phase (`phase.ts`) with the
 * member's OWN discipline facts of the day, derived entirely from existing
 * `Trade` rows (0 migration — "dérive > stockée", §3/§24).
 *
 * ARCHITECTURE. Like `lib/daily-guidance`, this is a UI orchestration read that
 * lives OUTSIDE the real-edge scoring tree : it touches NO P&L content, feeds NO
 * score, and is consumed solely by the dashboard. It reads only the entry TIME
 * and the discrete `outcome`/`closedAt` flags — never prices, never market data.
 *
 * POSTURE §2 + anti-Black-Hat (§31.2). The facts it surfaces are the method's
 * DISCIPLINE rules (1 trade/jour, fenêtre d'exécution, 1 SL = journée finie,
 * coupure 20h) — execution & psychology, never a market call. The consuming
 * component frames every one calmly (Mark Douglas), never as a red verdict.
 */

const PARIS_TZ = 'Europe/Paris';
/** Execution window [13h, 16h) Paris — the method's open-momentum entry slot. */
const EXEC_WINDOW_FROM_HOUR = 13;
const EXEC_WINDOW_TO_HOUR = 16;
/**
 * How far back to fetch candidate trades before filtering to "today (Paris)".
 * 36h comfortably brackets the Paris civil day regardless of UTC offset/DST, so
 * the JS-side `localDateOf` filter stays exact without any Paris-midnight math.
 */
const LOOKBACK_MS = 36 * 60 * 60 * 1000;

export interface SessionDayStatus {
  /** Trades ENTERED today (Paris civil day). The method targets exactly 1. */
  tradesEnteredToday: number;
  /** Of today's trades, how many were entered OUTSIDE the 13h–16h window. */
  enteredOutsideWindow: number;
  /** A loss (= the method's "SL") was taken today → the method ends the day. */
  lossToday: boolean;
  /** Any position still open (no `closedAt`) — relevant to the 20h cut. */
  hasOpenPosition: boolean;
}

export interface SessionRoutine {
  phase: SessionPhase;
  guidance: SessionPhaseGuidance;
  day: SessionDayStatus;
}

/**
 * Build one member's session routine for the given Europe/Paris instant. `now`
 * is injectable for deterministic tests. Two indexed, user-scoped reads only.
 */
export async function getSessionRoutine(
  userId: string,
  now: Date = new Date(),
): Promise<SessionRoutine> {
  const phase = currentSessionPhase(now, PARIS_TZ);
  const today = localDateOf(now, PARIS_TZ);
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const [recent, openCount] = await Promise.all([
    db.trade.findMany({
      where: { userId, enteredAt: { gte: since } },
      select: { enteredAt: true, outcome: true, closedAt: true },
    }),
    db.trade.count({ where: { userId, closedAt: null } }),
  ]);

  let tradesEnteredToday = 0;
  let enteredOutsideWindow = 0;
  let lossToday = false;
  for (const t of recent) {
    // Filter to the Paris civil day in JS (DST-safe) rather than computing the
    // Paris-midnight UTC bounds in the query.
    if (localDateOf(t.enteredAt, PARIS_TZ) !== today) continue;
    tradesEnteredToday += 1;
    const h = localHour(t.enteredAt, PARIS_TZ);
    if (h < EXEC_WINDOW_FROM_HOUR || h >= EXEC_WINDOW_TO_HOUR) enteredOutsideWindow += 1;
    if (t.closedAt !== null && t.outcome === 'loss') lossToday = true;
  }

  return {
    phase,
    guidance: sessionPhaseGuidance(phase),
    day: {
      tradesEnteredToday,
      enteredOutsideWindow,
      lossToday,
      hasOpenPosition: openCount > 0,
    },
  };
}
