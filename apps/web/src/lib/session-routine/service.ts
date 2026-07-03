import 'server-only';

import { localDateOf } from '@/lib/checkin/timezone';
import { localHour } from '@/lib/daily-guidance/slot';
import { db } from '@/lib/db';
import { getTodayPreTradeStatus } from '@/lib/pre-trade/service';

import {
  currentSessionPhase,
  sessionPhaseGuidance,
  type SessionPhase,
  type SessionPhaseGuidance,
} from './phase';

/**
 * Session 24 — Journée-type trader : the READ-ONLY day-status derivation for the
 * dashboard SessionTimeline. Combines the pure time-phase (`phase.ts`) with the
 * member's OWN discipline facts of the day, derived from existing `Trade` rows
 * (0 migration — "dérive > stockée", §3/§24) plus the member's read-only
 * pre-trade prep of the day (reused from `lib/pre-trade/service`, no new table).
 *
 * ARCHITECTURE. Like `lib/daily-guidance`, this is a UI orchestration read that
 * lives OUTSIDE the real-edge scoring tree : it touches NO P&L content, feeds NO
 * score, and is consumed solely by the dashboard. It reads only the entry TIME,
 * the discrete `outcome`/`closedAt` flags and the boolean/instant fact of the
 * pre-trade prep — never prices, never market data.
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
  /**
   * The member's pre-trade preparation of THEIR OWN calendar day (F2 — the
   * member's set timezone, NOT the Paris session clock). `done` mirrors
   * {@link getTodayPreTradeStatus}; `at` is the ISO instant of the most recent
   * check of the day (for a calm "posé à HHhMM" recall), or `null` if none yet.
   * Read-only reuse of the pre-trade helper (0 new query owned here).
   */
  preTradeToday: { done: boolean; at: string | null };
}

export interface SessionRoutine {
  phase: SessionPhase;
  guidance: SessionPhaseGuidance;
  day: SessionDayStatus;
}

/**
 * Build one member's session routine for the given instant. `now` is injectable
 * for deterministic tests.
 *
 * The session PHASE/clock is Paris-fixed (the method's NY-session hours read in
 * heure française — identical for the whole cohort). `timezone` is the member's
 * OWN IANA zone (F2) and is used ONLY to derive whether the pre-trade of THEIR
 * calendar day is done — never for the phase math. Defaults to Europe/Paris so
 * existing callers stay correct.
 *
 * Three indexed, user-scoped reads (2 trade reads + the pre-trade helper's one),
 * run concurrently — the pre-trade status is a read-only reuse of
 * {@link getTodayPreTradeStatus} (no new query owned here).
 */
export async function getSessionRoutine(
  userId: string,
  now: Date = new Date(),
  timezone: string = PARIS_TZ,
): Promise<SessionRoutine> {
  const phase = currentSessionPhase(now, PARIS_TZ);
  const today = localDateOf(now, PARIS_TZ);
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const [recent, openCount, preTradeToday] = await Promise.all([
    db.trade.findMany({
      where: { userId, enteredAt: { gte: since } },
      select: { enteredAt: true, outcome: true, closedAt: true },
    }),
    db.trade.count({ where: { userId, closedAt: null } }),
    // Member's own-day pre-trade prep (F2 timezone). Read-only helper reuse.
    getTodayPreTradeStatus(userId, timezone, now),
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
      preTradeToday: { done: preTradeToday.done, at: preTradeToday.at },
    },
  };
}
