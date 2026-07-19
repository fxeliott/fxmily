import 'server-only';

import { db } from '@/lib/db';
import { LEADERBOARD_EXCLUDED_EMAILS } from '@/lib/leaderboard/showcase';

/**
 * Réunion hub (séances) — replay VIEW telemetry (J6 scope 5).
 *
 * Records, per (session, member), that a member opened a replay séance, and
 * aggregates those rows into the admin "Vu par X/N" coverage badge on the
 * `/admin/seances` list.
 *
 * Posture §2 / privacy: this is engagement telemetry only — it stores WHO
 * opened WHICH published replay (member id + session id + open count), never
 * any behavioural / trade / free-text data. The write path is best-effort:
 * the member replay page calls {@link recordReplayView} inside `after()` and
 * swallows failures so a telemetry write can never break the reader's page.
 */

/**
 * Record that `userId` opened replay `sessionId`. Idempotent upsert on the
 * `(sessionId, userId)` unique:
 *   - **first open** → creates the row (`viewCount = 1`, `firstViewedAt = now`,
 *     `lastViewedAt = now`);
 *   - **re-open** → increments `viewCount` and refreshes `lastViewedAt`
 *     (`@updatedAt`), leaving `firstViewedAt` pinned to the first open.
 *
 * Callers wrap this in a try/catch (best-effort telemetry) — it never throws
 * on the happy path but the caller must treat a failure as a no-op.
 */
export async function recordReplayView(userId: string, sessionId: string): Promise<void> {
  await db.replayView.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    create: { sessionId, userId },
    update: { viewCount: { increment: 1 } },
  });
}

/**
 * Distinct viewer counts for a set of replay sessions, in ONE batched
 * `groupBy` (no N+1). Returns a `Map<sessionId, viewers>`; a session with zero
 * views is simply absent from the map (the caller defaults to 0).
 *
 * `(sessionId, userId)` is unique, so a plain per-session row count already
 * equals the number of DISTINCT viewers. The showcase/demo account
 * (`LEADERBOARD_EXCLUDED_EMAILS`) is excluded so the numerator stays
 * consistent with the {@link activeMemberCount} denominator (X ≤ N).
 */
export async function countViewersForSessions(sessionIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sessionIds.length === 0) return counts;

  const grouped = await db.replayView.groupBy({
    by: ['sessionId'],
    where: {
      sessionId: { in: sessionIds },
      // Exclude the shared showcase/demo vitrine from the "Vu par" numerator,
      // mirroring its exclusion from the active-member denominator below.
      user: { email: { notIn: [...LEADERBOARD_EXCLUDED_EMAILS] } },
    },
    _count: { _all: true },
  });

  for (const g of grouped) counts.set(g.sessionId, g._count._all);
  return counts;
}

/**
 * The denominator N for the "Vu par X/N" badge: the number of active members,
 * excluding the shared showcase/demo account. Reuses the same active-member
 * definition (`status === 'active'`) + demo exclusion as the leaderboard so the
 * two surfaces always agree on "who is a real member".
 */
export async function activeMemberCount(): Promise<number> {
  return db.user.count({
    where: { status: 'active', email: { notIn: [...LEADERBOARD_EXCLUDED_EMAILS] } },
  });
}
