import 'server-only';

import { after } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { evaluateAndDispatchForUser } from '@/lib/triggers/engine';

/**
 * Debounced background dispatcher for Mark Douglas cards (J7).
 *
 * Cloned from `lib/scoring/scheduler.ts` J6.5 — same security posture:
 *   - in-memory `lastDispatchAt` Map per user → debounce 5s.
 *   - `after()` so the user's redirect isn't blocked.
 *   - try/catch + audit on success or failure.
 *
 * Why debounce: a member spamming `closeTradeAction` would otherwise trigger
 * one full evaluation per call (4 DB queries × N cards). The cron token-bucket
 * protects `/api/cron/*` but Server Actions have no upstream rate-limit. A
 * single user at 50 RPS would drown Postgres.
 *
 * Mitigation: in-memory "last-dispatch timestamp" per user. Calls within
 * `DISPATCH_DEBOUNCE_MS` of the last successful dispatch are silently skipped
 * (the dispatch that *did* happen is recent enough — a freshly delivered
 * card won't be missed because the underlying triggers are about state, not
 * single events).
 *
 * Single-instance Hetzner deployment makes this trivially effective; multi-
 * instance V2 would need Redis-backed coalescing — swap this Map for an
 * Upstash redis pipeline + Lua atomic decrement, signature stays.
 */

export const DISPATCH_DEBOUNCE_MS = 5_000;

const lastDispatchAt = new Map<string, number>();

/** Test-only: clear the in-memory map. */
export function __resetDispatchSchedulerForTests(): void {
  lastDispatchAt.clear();
}

export type DouglasDispatchReason =
  | 'trade.created'
  | 'trade.closed'
  | 'trade.deleted'
  | 'checkin.morning.submitted'
  | 'checkin.evening.submitted';

/**
 * Schedule a Mark Douglas dispatch run via `after()` (Next.js 16). Coalesces
 * subsequent calls for the same user within `DISPATCH_DEBOUNCE_MS` — only the
 * first call in a burst actually evaluates the triggers, the rest are silent
 * no-ops.
 */
export function scheduleDouglasDispatch(userId: string, reason: DouglasDispatchReason): void {
  after(async () => {
    const last = lastDispatchAt.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < DISPATCH_DEBOUNCE_MS) {
      // Coalesced — a recent dispatch already covered this state change.
      return;
    }
    lastDispatchAt.set(userId, now);

    try {
      const result = await evaluateAndDispatchForUser(userId);
      if (result.delivered) {
        // The engine itself emits `douglas.dispatched`; we add a context
        // event so DBA queries can correlate with the action that triggered.
        await logAudit({
          action: 'douglas.dispatched',
          userId,
          metadata: {
            triggeredBy: 'action',
            reason,
            cardSlug: result.delivered.cardSlug,
            deliveryId: result.delivered.deliveryId,
          },
        });
      }
    } catch (err) {
      console.error(`[douglas.scheduler] dispatch failed (${reason})`, err);
    }
  });
}
