import 'server-only';

import { after } from 'next/server';

import { logAudit } from '@/lib/auth/audit';

import { recomputeAndPersist } from './service';

/**
 * Debounced background recompute scheduler (J6.5 audit-driven).
 *
 * Used by Server Actions (`closeTradeAction`, `submitMorningCheckin`, …) to
 * recompute behavioral scores after the response is sent — without blocking
 * the user-facing redirect.
 *
 * **Why this layer exists** (J6.5 security audit ÉLEVÉ — DoS amplification):
 * a member spamming `closeTradeAction` would trigger one full
 * `recomputeAndPersist` per call (4 dimensions × 30-day Prisma fetch + upsert)
 * with no upstream rate-limit. A single user at 50 RPS would drown the
 * Postgres pool. The cron token-bucket protects `/api/cron/*` but Server
 * Actions are a separate surface.
 *
 * Mitigation: in-memory "last-recompute timestamp" per user. Calls within
 * `RECOMPUTE_DEBOUNCE_MS` of the last successful run are silently skipped
 * (the recompute that *did* happen is recent enough — the dashboard will
 * pick it up). Single-instance Hetzner deployment makes this trivially
 * effective; multi-instance (V2 horizontal scale) would need Redis-backed
 * coalescing, swapped here without changing the callers.
 *
 * Posture: also emits an `audit_logs` row per actually-performed recompute
 * (`action = 'score.computed'`) so DBA-side queries can answer "why /
 * when did this score change?" — closes the J6.5 audit MEDIUM gap on
 * traceability.
 */

/** Minimum interval (ms) between two background recomputes for the same user. */
export const RECOMPUTE_DEBOUNCE_MS = 5_000;

const lastRecomputeAt = new Map<string, number>();

/** Test-only: clear the in-memory map. */
export function __resetSchedulerForTests(): void {
  lastRecomputeAt.clear();
}

export type ScoreRecomputeReason =
  | 'trade.created'
  | 'trade.closed'
  | 'trade.deleted'
  | 'checkin.morning.submitted'
  | 'checkin.evening.submitted';

/**
 * Schedule a background recompute via `after()` (Next.js 16). Coalesces
 * subsequent calls for the same user within `RECOMPUTE_DEBOUNCE_MS` — only
 * the first call in a burst actually runs the recompute, the rest are
 * silent no-ops (the dashboard sees the fresh snapshot anyway).
 */
export function scheduleScoreRecompute(userId: string, reason: ScoreRecomputeReason): void {
  after(async () => {
    const last = lastRecomputeAt.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < RECOMPUTE_DEBOUNCE_MS) {
      // Coalesced — a recent recompute already covers this change.
      return;
    }
    // Reserve the slot BEFORE running so concurrent calls in the same
    // process tick collapse onto one execution.
    lastRecomputeAt.set(userId, now);

    try {
      await recomputeAndPersist(userId);
      await logAudit({
        action: 'score.computed',
        userId,
        metadata: { reason, triggeredBy: 'action' },
      });
    } catch (err) {
      // Don't let a recompute failure surface to the user — they already
      // got their action redirect. Log + best-effort audit so DBA can spot
      // chronic failures via `audit_logs`.
      console.error(`[scoring] background recompute failed (${reason})`, err);
      await logAudit({
        action: 'score.computed',
        userId,
        metadata: {
          reason,
          triggeredBy: 'action',
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      }).catch(() => {
        /* swallow — audit failure on top of recompute failure */
      });
    }
  });
}
