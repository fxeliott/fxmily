import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Showcase/demo exclusion — `recomputeLeaderboard` must (1) purge any snapshot
 * row belonging to an excluded account and (2) never gather one into the
 * ranking. This pins the two wiring lines a future refactor could silently
 * drop, which would either resurface the demo on the board or (worse) start
 * dropping real members.
 *
 * Same mock harness convention as `scoring/service.fairindex.test.ts`: only the
 * `db` methods `recomputeLeaderboard` touches directly are mocked. An EMPTY
 * gather is returned on purpose so the per-member `gatherMember` fan-out (which
 * hits the scoring/tracking/verification services) is never reached — we assert
 * the exclusion plumbing, not Postgres.
 */

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany },
    leaderboardSnapshot: { deleteMany: m.snapshotDeleteMany, upsert: m.snapshotUpsert },
  },
}));

import { recomputeLeaderboard } from './service';

// Fixed instant so the anchor/window derivation is deterministic (no Date.now).
const NOW = new Date('2026-02-15T12:00:00.000Z');
const DEMO_EMAIL = 'demo@fxmily.local';

describe('recomputeLeaderboard — showcase/demo exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Empty gather ⇒ no gatherMember/upsert, so this stays a pure wiring test.
    m.userFindMany.mockResolvedValue([]);
    m.snapshotDeleteMany.mockResolvedValue({ count: 0 });
  });

  it('purges any snapshot row belonging to an excluded showcase account', async () => {
    await recomputeLeaderboard(NOW);
    expect(m.snapshotDeleteMany).toHaveBeenCalledTimes(1);
    expect(m.snapshotDeleteMany).toHaveBeenCalledWith({
      where: { user: { email: { in: [DEMO_EMAIL] } } },
    });
  });

  it('never gathers an excluded showcase account into the ranking', async () => {
    await recomputeLeaderboard(NOW);
    expect(m.userFindMany).toHaveBeenCalledTimes(1);
    const arg = m.userFindMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      status: 'active',
      email: { notIn: [DEMO_EMAIL] },
    });
  });

  it('writes no snapshot when no eligible member remains', async () => {
    const result = await recomputeLeaderboard(NOW);
    expect(m.snapshotUpsert).not.toHaveBeenCalled();
    expect(result.computed).toBe(0);
    expect(result.ranked).toBe(0);
  });
});
