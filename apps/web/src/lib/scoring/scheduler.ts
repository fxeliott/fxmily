import 'server-only';

import { after } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { localDateOf } from '@/lib/checkin/timezone';
import { reportWarning } from '@/lib/observability';

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

/**
 * Global cap on concurrent background recomputes across the WHOLE cohort
 * (J7 stress-test fix). The per-user debounce above only coalesces repeated
 * calls from the *same* user; it does nothing when 100 distinct members check
 * in during the 21:00 window. Each `recomputeAndPersist` fans out to ~10 Prisma
 * round-trips (2×30-day `findMany` + training + meeting + off-days + upsert),
 * and the pg pool is capped at `DATABASE_POOL_MAX` (default 10, floor 8). An
 * unbounded burst of N recomputes therefore demands ~10·N connections at once
 * and starves the foreground request path (dashboards, other check-ins) into
 * 5 s `connectionTimeoutMillis` throws.
 *
 * A small semaphore keeps at most `MAX_CONCURRENT_RECOMPUTES` recompute
 * pipelines in flight; the rest queue and drain post-response (they already run
 * inside `after()`, so the added latency is invisible to the member). This
 * bounds background connection demand to a fraction of the pool and leaves the
 * majority for foreground traffic — regardless of cohort size.
 *
 * Single-instance V1 (Hetzner). Multi-instance V2 would move this to a shared
 * limiter (Redis token bucket) without changing the call sites.
 */
export const MAX_CONCURRENT_RECOMPUTES = 3;

let activeRecomputes = 0;
const recomputeWaiters: Array<() => void> = [];

/** Acquire one recompute slot, awaiting a free one if the cap is reached. */
function acquireRecomputeSlot(): Promise<void> {
  if (activeRecomputes < MAX_CONCURRENT_RECOMPUTES) {
    activeRecomputes += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    recomputeWaiters.push(resolve);
  });
}

/** Release a slot, handing it straight to the next waiter if any. */
function releaseRecomputeSlot(): void {
  const next = recomputeWaiters.shift();
  if (next) {
    // Hand the slot over directly — `activeRecomputes` stays unchanged.
    next();
  } else {
    activeRecomputes = Math.max(0, activeRecomputes - 1);
  }
}

/** Test-only: clear the in-memory debounce map + concurrency state. */
export function __resetSchedulerForTests(): void {
  lastRecomputeAt.clear();
  activeRecomputes = 0;
  recomputeWaiters.length = 0;
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
 *
 * **CRITICAL — `timezone` is mandatory** (J6.5 code-review B1 fix). The
 * service's default `asOf` is yesterday-local (industry-standard nightly
 * snapshot policy). Letting it default here would mean the snapshot
 * EXCLUDES the action that just fired (today's trade close, today's
 * check-in) — making the whole `after()` wiring theatre. We pass
 * `localDateOf(now, timezone)` (today-local) so the freshly-submitted
 * data is part of the window. Result: the dashboard reflects the user's
 * just-completed action on the next render, as advertised.
 */
export function scheduleScoreRecompute(
  userId: string,
  reason: ScoreRecomputeReason,
  timezone: string,
): void {
  after(async () => {
    const last = lastRecomputeAt.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < RECOMPUTE_DEBOUNCE_MS) {
      // Coalesced — a recent recompute already covers this change.
      return;
    }
    // Reserve the debounce slot BEFORE running so concurrent calls for the
    // same user in the same process tick collapse onto one execution.
    lastRecomputeAt.set(userId, now);

    // Bound cohort-wide concurrency: under a mass check-in burst this queues
    // the recompute behind at most MAX_CONCURRENT_RECOMPUTES in-flight ones so
    // the pg pool isn't drained. Runs post-response, so the wait is invisible.
    await acquireRecomputeSlot();
    try {
      // Anchor on today-local so the just-submitted action is in-window.
      // Uses `localDateOf` for DST-safe local-day computation in `timezone`.
      const today = localDateOf(new Date(), timezone);
      await recomputeAndPersist(userId, today, { timezone });
      await logAudit({
        action: 'score.computed',
        userId,
        metadata: { reason, triggeredBy: 'action', anchor: today },
      });
    } catch (err) {
      // V1.6 polish — Don't let a recompute failure surface to the user; they
      // already got their action redirect. Cron picks up next night. Sentry
      // warning (not error) since the audit row below carries the error detail
      // and a single failed recompute is recoverable by the next scheduled run.
      reportWarning('scoring.scheduler', 'background_recompute_failed', {
        userId,
        reason,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
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
    } finally {
      releaseRecomputeSlot();
    }
  });
}
