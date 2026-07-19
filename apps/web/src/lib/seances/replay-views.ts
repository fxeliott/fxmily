import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { LEADERBOARD_EXCLUDED_EMAILS } from '@/lib/leaderboard/showcase';

/**
 * The single "real member" cohort predicate, shared by the badge NUMERATOR
 * ({@link countViewersForSessions}) and DENOMINATOR ({@link activeMemberCount}).
 * Factoring it here is the root-cause fix for the "Vu par X/N" badge that could
 * never reach 100 %: the denominator used to count active admins (no `role`
 * filter) while the numerator can only ever contain members, so N > X even when
 * every member had watched. One definition ⇒ numerator and denominator can never
 * diverge again (Prisma only reads the predicate, so a single shared object is
 * safe).
 */
const REAL_MEMBER_WHERE: Prisma.UserWhereInput = {
  status: 'active',
  role: 'member',
  email: { notIn: [...LEADERBOARD_EXCLUDED_EMAILS] },
};

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
      // Count a view only if its author is a REAL MEMBER of the cohort — the
      // exact same predicate as the {@link activeMemberCount} denominator, so X
      // and N can never drift and X ≤ N always holds: an active, role `member`,
      // non-demo user. This keeps out admins who previewed the replay (the write
      // path already gates `role === 'member'`, but a member later promoted to
      // admin would otherwise leave a counted row) and a viewer who has since
      // been suspended (they drop out of N, so they must drop out of X too).
      user: REAL_MEMBER_WHERE,
    },
    _count: { _all: true },
  });

  for (const g of grouped) counts.set(g.sessionId, g._count._all);
  return counts;
}

/**
 * The denominator N for the "Vu par X/N" badge: the number of active MEMBERS
 * (role `member`), excluding the shared showcase/demo account. Uses the shared
 * {@link REAL_MEMBER_WHERE} predicate so N counts exactly the cohort the
 * numerator draws from — admins (who can never appear in X) are no longer
 * inflating N, so the badge can actually reach 100 %.
 */
export async function activeMemberCount(): Promise<number> {
  return db.user.count({ where: REAL_MEMBER_WHERE });
}
