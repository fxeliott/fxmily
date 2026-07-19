import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    reflectionEntry: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import { listReflectionsForAdmin, listReflectionsForMemberAsAdmin } from './reflections-service';

// A cross-member row as selected by `listReflectionsForAdmin` (carries the
// joined `user` identity slice).
function makeAdminRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: `member-${id}`,
    date: new Date('2026-07-10T00:00:00.000Z'),
    triggerEvent: `A-${id}`,
    beliefAuto: `B-${id}`,
    consequence: `C-${id}`,
    disputation: `D-${id}`,
    createdAt: new Date('2026-07-10T08:30:00.000Z'),
    user: { firstName: 'Alex', lastName: 'Trader', email: `${id}@fxmily.local` },
    ...overrides,
  };
}

// A single-member row as returned by `listReflectionsForMemberAsAdmin` (no
// `user` join — it is scoped to one member already).
function makeMemberRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'member-1',
    date: new Date('2026-07-10T00:00:00.000Z'),
    triggerEvent: `A-${id}`,
    beliefAuto: `B-${id}`,
    consequence: `C-${id}`,
    disputation: `D-${id}`,
    createdAt: new Date('2026-07-10T08:30:00.000Z'),
    ...overrides,
  };
}

type FindManyArg = {
  where?: { userId?: string };
  orderBy: Array<Record<string, string>>;
  take: number;
  cursor?: { id: string };
  skip?: number;
  select?: Record<string, unknown>;
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// listReflectionsForAdmin — cross-member chronological feed + cursor.
// ---------------------------------------------------------------------------

describe('listReflectionsForAdmin (cross-member feed)', () => {
  it('page 1, no cursor: [createdAt desc, id desc], take=limit+1, no cursor/skip, joins user identity', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([makeAdminRow('r1')] as never);

    const result = await listReflectionsForAdmin();

    const call = vi.mocked(db.reflectionEntry.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as FindManyArg;
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(51); // default limit 50 + 1 look-ahead
    expect(arg).not.toHaveProperty('cursor');
    expect(arg).not.toHaveProperty('skip');
    // The feed is cross-member: it does NOT scope on userId.
    expect(arg.where).toBeUndefined();
    // It selects the joined member identity the row link needs.
    expect(arg.select?.user).toEqual({
      select: { firstName: true, lastName: true, email: true },
    });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('applies cursor + skip:1 when a cursor is supplied', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    await listReflectionsForAdmin({ cursor: 'cur-1' });

    const arg = vi.mocked(db.reflectionEntry.findMany).mock.calls[0]?.[0] as FindManyArg;
    expect(arg.cursor).toEqual({ id: 'cur-1' });
    expect(arg.skip).toBe(1);
  });

  it('full page: 51 rows → 50 items + nextCursor = id of the 50th', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeAdminRow(`r-${i}`));
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue(rows as never);

    const result = await listReflectionsForAdmin({ limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('r-49');
  });

  it('boundary: exactly `limit` rows (no look-ahead row) → nextCursor null', async () => {
    // Guards the `hasMore = rows.length > limit` frontier — a `>=` typo would
    // wrongly emit a nextCursor here and loop the admin into an empty page.
    const rows = Array.from({ length: 50 }, (_, i) => makeAdminRow(`r-${i}`));
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue(rows as never);

    const result = await listReflectionsForAdmin({ limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBeNull();
  });

  it('clamps limit into [1, 50]', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    await listReflectionsForAdmin({ limit: 9999 });
    expect((vi.mocked(db.reflectionEntry.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(
      51,
    );

    vi.mocked(db.reflectionEntry.findMany).mockClear();
    await listReflectionsForAdmin({ limit: 0 });
    expect((vi.mocked(db.reflectionEntry.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(2);
  });

  it('empty page short-circuits to { items: [], nextCursor: null }', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    const result = await listReflectionsForAdmin();

    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('maps userId → memberId, joins display name (fullName || email), and surfaces ABCD verbatim', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([
      makeAdminRow('r1', {
        userId: 'u-42',
        user: { firstName: 'Eliott', lastName: 'Pena', email: 'eliott@fxmily.local' },
      }),
    ] as never);

    const result = await listReflectionsForAdmin();

    expect(result.items[0]).toEqual({
      id: 'r1',
      memberId: 'u-42',
      memberDisplayName: 'Eliott Pena',
      memberEmail: 'eliott@fxmily.local',
      date: '2026-07-10',
      triggerEvent: 'A-r1',
      beliefAuto: 'B-r1',
      consequence: 'C-r1',
      disputation: 'D-r1',
      createdAt: '2026-07-10T08:30:00.000Z',
    });
  });

  it('falls back to the email when both name parts are empty', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([
      makeAdminRow('r1', {
        user: { firstName: null, lastName: null, email: 'noname@fxmily.local' },
      }),
    ] as never);

    const result = await listReflectionsForAdmin();

    expect(result.items[0]?.memberDisplayName).toBe('noname@fxmily.local');
  });
});

// ---------------------------------------------------------------------------
// listReflectionsForMemberAsAdmin — per-member feed + isolation.
// ---------------------------------------------------------------------------

describe('listReflectionsForMemberAsAdmin (single-member feed)', () => {
  it('scopes the query to { userId: memberId } with the same order/cursor semantics', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([makeMemberRow('r1')] as never);

    const result = await listReflectionsForMemberAsAdmin('member-1');

    const arg = vi.mocked(db.reflectionEntry.findMany).mock.calls[0]?.[0] as FindManyArg;
    // Cross-member isolation: exactly this member's rows, never anyone else's.
    expect(arg.where).toEqual({ userId: 'member-1' });
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(51);
    expect(arg).not.toHaveProperty('cursor');
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('applies cursor + skip:1 while keeping the userId scope', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    await listReflectionsForMemberAsAdmin('member-9', { cursor: 'cur-9' });

    const arg = vi.mocked(db.reflectionEntry.findMany).mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where).toEqual({ userId: 'member-9' });
    expect(arg.cursor).toEqual({ id: 'cur-9' });
    expect(arg.skip).toBe(1);
  });

  it('full page: 51 rows → 50 serialized items + nextCursor = id of the 50th', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeMemberRow(`r-${i}`));
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue(rows as never);

    const result = await listReflectionsForMemberAsAdmin('member-1', { limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('r-49');
  });

  it('boundary: exactly `limit` rows → nextCursor null', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeMemberRow(`r-${i}`));
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue(rows as never);

    const result = await listReflectionsForMemberAsAdmin('member-1', { limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBeNull();
  });

  it('serializes rows to the member-facing shape (Date → string, keeps userId)', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([
      makeMemberRow('r1', { userId: 'member-7' }),
    ] as never);

    const result = await listReflectionsForMemberAsAdmin('member-7');

    expect(result.items[0]).toEqual({
      id: 'r1',
      userId: 'member-7',
      date: '2026-07-10',
      triggerEvent: 'A-r1',
      beliefAuto: 'B-r1',
      consequence: 'C-r1',
      disputation: 'D-r1',
      createdAt: '2026-07-10T08:30:00.000Z',
    });
  });

  it('empty page short-circuits to { items: [], nextCursor: null }', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    const result = await listReflectionsForMemberAsAdmin('member-1');

    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
