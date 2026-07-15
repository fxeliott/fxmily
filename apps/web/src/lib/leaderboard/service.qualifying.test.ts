import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "En qualification" derivation (J3 SCOPE 1) — `getLeaderboardBoard` must expose
 * every active, NOT-yet-ranked member (`rank === null`) in `board.qualifying`,
 * with their PUBLIC "X/N jours actifs" progression, honouring the same opt-out
 * guard as the ranked rows (hidden from others, always visible to the viewer)
 * and sorted closest-to-qualifying first.
 *
 * Same mock convention as `service.demo-exclusion.test.ts`: only the two `db`
 * methods `getLeaderboardBoard` touches are mocked — `findFirst` (latest board
 * date) + `findMany` (the snapshot rows). `getLeaderboardBoard` is wrapped in
 * `React.cache()`, and `latestBoardDate` is a zero-arg `cache()`; per the
 * established `checkin/service.test.ts` workaround, each case uses a globally
 * DISTINCT `viewerId` so a per-argument memoisation can never collapse two
 * cases, and `findFirst` returns a STABLE date so the shared zero-arg cache is
 * harmless.
 */

const m = vi.hoisted(() => ({
  snapshotFindFirst: vi.fn(),
  snapshotFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    leaderboardSnapshot: {
      findFirst: m.snapshotFindFirst,
      findMany: m.snapshotFindMany,
    },
  },
}));

import { getLeaderboardBoard } from './service';

const BOARD_DATE = new Date('2026-07-14T00:00:00.000Z');

/** A not-yet-ranked (qualifying) snapshot row. */
function qualRow(opts: {
  userId: string;
  firstName: string;
  activeDays: number;
  minActiveDays?: number;
  optOut?: boolean;
}) {
  const minActiveDays = opts.minActiveDays ?? 7;
  return {
    userId: opts.userId,
    score: null,
    rank: null, // qualifying = not yet ranked
    status: 'insufficient_data',
    components: { score: { sample: { days: opts.activeDays } } },
    sampleSize: {
      activeDays: opts.activeDays,
      windowDays: 30,
      activePillars: 1,
      minActiveDays,
    },
    user: {
      firstName: opts.firstName,
      lastName: null,
      avatarKey: null,
      image: null,
      leaderboardOptOut: opts.optOut ?? false,
    },
  };
}

/** A ranked snapshot row (must NEVER leak into `qualifying`). */
function rankedRow(opts: { userId: string; firstName: string; rank: number; score: number }) {
  return {
    userId: opts.userId,
    score: opts.score,
    rank: opts.rank,
    status: 'ok',
    components: { score: { sample: { days: 30 } } },
    sampleSize: { activeDays: 30, windowDays: 30, activePillars: 4, minActiveDays: 7 },
    user: {
      firstName: opts.firstName,
      lastName: null,
      avatarKey: null,
      image: null,
      leaderboardOptOut: false,
    },
  };
}

describe('getLeaderboardBoard — "En qualification" (J3 SCOPE 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stable board date: the zero-arg `latestBoardDate` cache resolves the same
    // value for every case, so the qualifying derivation is what varies.
    m.snapshotFindFirst.mockResolvedValue({ date: BOARD_DATE });
  });

  it('(a) surfaces a day-1, not-yet-ranked member and excludes ranked members', async () => {
    m.snapshotFindMany.mockResolvedValue([
      rankedRow({ userId: 'qual-a-ranked', firstName: 'Léa', rank: 1, score: 80 }),
      qualRow({ userId: 'qual-a-day1', firstName: 'Tom', activeDays: 1, minActiveDays: 7 }),
    ]);

    const board = await getLeaderboardBoard('qual-a-viewer');

    expect(board.qualifying).toHaveLength(1);
    const [row] = board.qualifying;
    expect(row).toMatchObject({
      userId: 'qual-a-day1',
      firstName: 'Tom',
      activeDays: 1,
      minActiveDays: 7,
      isViewer: false,
    });
    // The ranked member stays out of the qualifying list (it belongs in `rows`).
    expect(board.qualifying.map((r) => r.userId)).not.toContain('qual-a-ranked');
  });

  it('(b) hides an opted-out member from OTHER viewers', async () => {
    m.snapshotFindMany.mockResolvedValue([
      qualRow({ userId: 'qual-b-normal', firstName: 'Nora', activeDays: 2 }),
      qualRow({ userId: 'qual-b-optout', firstName: 'Otto', activeDays: 4, optOut: true }),
    ]);

    const board = await getLeaderboardBoard('qual-b-viewer');

    const ids = board.qualifying.map((r) => r.userId);
    expect(ids).toContain('qual-b-normal');
    expect(ids).not.toContain('qual-b-optout');
  });

  it('(c) still shows an opted-out member to THEMSELVES (the viewer)', async () => {
    m.snapshotFindMany.mockResolvedValue([
      qualRow({ userId: 'qual-c-self', firstName: 'Ivy', activeDays: 3, optOut: true }),
    ]);

    const board = await getLeaderboardBoard('qual-c-self');

    expect(board.qualifying).toHaveLength(1);
    expect(board.qualifying[0]).toMatchObject({ userId: 'qual-c-self', isViewer: true });
  });

  it('(d) sorts closest-first: activeDays desc, then firstName (fr) asc', async () => {
    m.snapshotFindMany.mockResolvedValue([
      qualRow({ userId: 'qual-d-bob', firstName: 'Bob', activeDays: 3 }),
      qualRow({ userId: 'qual-d-zoe', firstName: 'Zoé', activeDays: 6 }),
      qualRow({ userId: 'qual-d-anna', firstName: 'Anna', activeDays: 3 }),
    ]);

    const board = await getLeaderboardBoard('qual-d-viewer');

    // Zoé (6) first, then the two ties at 3 broken by firstName asc: Anna before Bob.
    expect(board.qualifying.map((r) => r.firstName)).toEqual(['Zoé', 'Anna', 'Bob']);
  });
});
