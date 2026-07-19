import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J6 (admin-scale, scope 5) — the "Vu par X/N" replay-coverage badge cohort.
 *
 * Root-cause regression guard for a badge that could never reach 100 % (and
 * could even exceed it): the NUMERATOR (distinct viewers, {@link
 * countViewersForSessions}) and the DENOMINATOR (active members, {@link
 * activeMemberCount}) must draw from the SAME "real member" cohort — active,
 * role `member`, non-demo. Otherwise an active admin inflates N (badge stuck
 * below 100 %) and a since-suspended past viewer inflates X (badge > 100 %).
 *
 * These tests pin the shared predicate at the query-construction layer, mocking
 * Prisma so no Postgres is needed. On the PRE-FIX code — denominator lacking
 * `role:'member'`, numerator lacking `status:'active'` — they FAIL, which is
 * exactly the coverage the J6 re-audit flagged as missing.
 */

const { groupByMock, userCountMock } = vi.hoisted(() => ({
  groupByMock: vi.fn(),
  userCountMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    replayView: { groupBy: groupByMock },
    user: { count: userCountMock },
  },
}));

// Imported AFTER the mocks are registered (vi.mock is hoisted above imports).
import { LEADERBOARD_EXCLUDED_EMAILS } from '@/lib/leaderboard/showcase';
import { activeMemberCount, countViewersForSessions } from '@/lib/seances/replay-views';

/** The exact cohort predicate both queries must share (X ≤ N invariant). */
const REAL_MEMBER_WHERE = {
  status: 'active',
  role: 'member',
  email: { notIn: [...LEADERBOARD_EXCLUDED_EMAILS] },
};

beforeEach(() => {
  groupByMock.mockReset();
  userCountMock.mockReset();
});

describe('activeMemberCount — badge denominator N', () => {
  it('counts ONLY active, role="member", non-demo users (admins never inflate N)', async () => {
    userCountMock.mockResolvedValueOnce(30);

    const n = await activeMemberCount();

    expect(n).toBe(30);
    expect(userCountMock).toHaveBeenCalledTimes(1);
    const where = (userCountMock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual(REAL_MEMBER_WHERE);
    // The two filters the pre-fix denominator lacked are present: `role` is what
    // kept active admins out of N (the never-100 % bug), `status` keeps suspended
    // users out.
    expect(where.role).toBe('member');
    expect(where.status).toBe('active');
    expect(where.email).toEqual({ notIn: ['demo@fxmily.local'] });
  });
});

describe('countViewersForSessions — badge numerator X', () => {
  it('short-circuits on an empty session list without touching the DB', async () => {
    const map = await countViewersForSessions([]);

    expect(map.size).toBe(0);
    expect(groupByMock).not.toHaveBeenCalled();
  });

  it('counts a view only from an active, role="member", non-demo author (X ≤ N)', async () => {
    groupByMock.mockResolvedValueOnce([
      { sessionId: 's1', _count: { _all: 12 } },
      { sessionId: 's2', _count: { _all: 3 } },
    ]);

    const map = await countViewersForSessions(['s1', 's2', 's3']);

    expect(map.get('s1')).toBe(12);
    expect(map.get('s2')).toBe(3);
    // A session with zero real-member views is absent — the caller defaults to 0.
    expect(map.has('s3')).toBe(false);

    const where = (
      groupByMock.mock.calls[0]?.[0] as {
        where: { user: Record<string, unknown>; sessionId: unknown };
      }
    ).where;
    expect(where.sessionId).toEqual({ in: ['s1', 's2', 's3'] });
    expect(where.user).toEqual(REAL_MEMBER_WHERE);
    // `status:'active'` is what the pre-fix numerator lacked — without it a
    // since-suspended past viewer stayed counted in X while dropping from N,
    // pushing the badge above 100 %.
    expect(where.user.status).toBe('active');
    expect(where.user.role).toBe('member');
  });
});

describe('X ≤ N invariant — one shared cohort predicate', () => {
  it('passes the SAME real-member predicate to both queries so they can never drift', async () => {
    userCountMock.mockResolvedValueOnce(0);
    groupByMock.mockResolvedValueOnce([]);

    await activeMemberCount();
    await countViewersForSessions(['s1']);

    const denomWhere = (userCountMock.mock.calls[0]?.[0] as { where: unknown }).where;
    const numerWhere = (groupByMock.mock.calls[0]?.[0] as { where: { user: unknown } }).where.user;
    expect(numerWhere).toEqual(denomWhere);
  });
});
