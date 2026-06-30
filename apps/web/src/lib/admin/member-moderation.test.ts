/**
 * Member-moderation service tests (Prisma-mocked) — F5 (overhaul 2026-06-30),
 * SPEC §7.1 "Eliot peut suspendre / supprimer un membre".
 *
 * Runs the REAL service against a tiny in-memory Prisma stand-in (mirror of
 * `password-reset.test.ts`), so the atomic guarded `updateMany` + the event
 * append inside the SAME `$transaction` are exercised end-to-end:
 *
 *   suspendMember : active member → suspended + tokenVersion++ + `suspended` event
 *     → guard: an already-suspended member, a `deleted` member, or an ADMIN row
 *       yields count 0 → { ok:false, not_active }, NO event written
 *   reinstateMember : suspended → active (NO tokenVersion bump) + `reinstated` event
 *     → guard: an active member yields { ok:false, not_suspended }, NO event
 *   listModerationHistory : newest-first, bounded by `take`
 *
 * The status/role predicates stay REAL (the security contract), only Prisma is
 * mocked. The `tokenVersion` bump is the eject-everywhere mechanism (every JWT
 * is torn down at its next `auth()` via `applyRevocationCheck`), so the test
 * pins that suspend bumps it and reinstate does NOT.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface UserRow {
  id: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  tokenVersion: number;
}
interface EventRow {
  id: string;
  memberId: string;
  actorId: string | null;
  action: 'suspended' | 'reinstated';
  reason: string | null;
  createdAt: Date;
}

const BASE = new Date('2026-06-30T08:00:00.000Z').getTime();

const store = vi.hoisted(() => {
  return {
    users: [] as UserRow[],
    events: [] as EventRow[],
    seq: 0,
  };
});

function buildDbApi(s: typeof store) {
  const api = {
    user: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string; role?: string };
          data: { status?: string; tokenVersion?: { increment: number } };
        }) => {
          const row = s.users.find(
            (u) =>
              u.id === where.id &&
              (where.status === undefined || u.status === where.status) &&
              (where.role === undefined || u.role === where.role),
          );
          if (!row) return { count: 0 };
          if (data.status !== undefined) row.status = data.status as UserRow['status'];
          if (data.tokenVersion?.increment) row.tokenVersion += data.tokenVersion.increment;
          return { count: 1 };
        },
      ),
    },
    memberModerationEvent: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            memberId: string;
            actorId: string | null;
            action: 'suspended' | 'reinstated';
            reason: string | null;
          };
        }) => {
          const row: EventRow = {
            id: `mme-${++s.seq}`,
            memberId: data.memberId,
            actorId: data.actorId ?? null,
            action: data.action,
            reason: data.reason ?? null,
            // Monotonic per-create so `orderBy createdAt desc` is deterministic.
            createdAt: new Date(BASE + s.seq * 1000),
          };
          s.events.push(row);
          return { ...row };
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { memberId: string };
          orderBy: { createdAt: 'desc' };
          take?: number;
        }) => {
          const rows = s.events
            .filter((e) => e.memberId === where.memberId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return (take === undefined ? rows : rows.slice(0, take)).map((r) => ({ ...r }));
        },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: typeof api) => Promise<unknown>) => cb(api)),
  };
  return api;
}

vi.mock('@/lib/db', () => ({ db: buildDbApi(store) }));

const { suspendMember, reinstateMember, listModerationHistory } =
  await import('./member-moderation');

function seedUser(overrides: Partial<UserRow> = {}): UserRow {
  const row: UserRow = {
    id: 'member-1',
    role: 'member',
    status: 'active',
    tokenVersion: 2,
    ...overrides,
  };
  store.users.push(row);
  return row;
}

beforeEach(() => {
  store.users = [];
  store.events = [];
  store.seq = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// suspendMember
// ---------------------------------------------------------------------------

describe('suspendMember', () => {
  it('flips an active member to suspended, bumps tokenVersion, and appends a suspended event', async () => {
    const user = seedUser({ tokenVersion: 2 });

    const result = await suspendMember({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: 'Abus',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(user.status).toBe('suspended');
    expect(user.tokenVersion).toBe(3); // 2 → 3 : every JWT torn down next auth()
    expect(store.events).toHaveLength(1);
    expect(result.event.action).toBe('suspended');
    expect(result.event.memberId).toBe('member-1');
    expect(result.event.actorId).toBe('admin-1');
    expect(result.event.reason).toBe('Abus');
    expect(typeof result.event.createdAt).toBe('string'); // serialized to ISO
  });

  it('stores a null motif when none is given (suspend "sans motif")', async () => {
    seedUser();
    const result = await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.event.reason).toBeNull();
  });

  it('refuses an already-suspended member (not_active) and writes NO event', async () => {
    const user = seedUser({ status: 'suspended', tokenVersion: 5 });

    const result = await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: null });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_active');
    expect(user.tokenVersion).toBe(5); // untouched
    expect(store.events).toHaveLength(0);
  });

  it('refuses to suspend an ADMIN row (role guard at the DB predicate) — not_active, no event', async () => {
    const admin = seedUser({ id: 'admin-2', role: 'admin', status: 'active', tokenVersion: 1 });

    const result = await suspendMember({ memberId: 'admin-2', actorId: 'admin-1', reason: null });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_active');
    expect(admin.status).toBe('active'); // never demoted
    expect(store.events).toHaveLength(0);
  });

  it('refuses a deleted member (not_active)', async () => {
    seedUser({ status: 'deleted' });
    const result = await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: null });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_active');
  });

  it('refuses a member that does not exist (not_active)', async () => {
    const result = await suspendMember({ memberId: 'ghost', actorId: 'admin-1', reason: null });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_active');
    expect(store.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reinstateMember
// ---------------------------------------------------------------------------

describe('reinstateMember', () => {
  it('flips a suspended member back to active WITHOUT bumping tokenVersion, and appends a reinstated event', async () => {
    const user = seedUser({ status: 'suspended', tokenVersion: 7 });

    const result = await reinstateMember({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: 'Reprise',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(user.status).toBe('active');
    expect(user.tokenVersion).toBe(7); // NOT bumped — a suspended member holds no session
    expect(result.event.action).toBe('reinstated');
    expect(result.event.reason).toBe('Reprise');
    expect(store.events).toHaveLength(1);
  });

  it('refuses an active member (not_suspended) and writes NO event', async () => {
    seedUser({ status: 'active' });
    const result = await reinstateMember({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_suspended');
    expect(store.events).toHaveLength(0);
  });

  it('refuses a deleted member (not_suspended — RGPD lifecycle, not moderation)', async () => {
    seedUser({ status: 'deleted' });
    const result = await reinstateMember({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_suspended');
  });

  it('refuses to reactivate a suspended ADMIN row (role guard, defense-in-depth)', async () => {
    // An admin can only reach `suspended` via a direct DB edit / a future
    // out-of-scope path; moderation must NEVER silently flip it back to active.
    const admin = seedUser({ id: 'admin-2', role: 'admin', status: 'suspended' });
    const result = await reinstateMember({ memberId: 'admin-2', actorId: 'admin-1', reason: null });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not_suspended');
    expect(admin.status).toBe('suspended'); // never reactivated
    expect(store.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listModerationHistory
// ---------------------------------------------------------------------------

describe('listModerationHistory', () => {
  it('returns events newest-first and only for the requested member', async () => {
    seedUser({ id: 'member-1', status: 'active' });
    seedUser({ id: 'member-2', status: 'active' });

    await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: 'first' });
    await reinstateMember({ memberId: 'member-1', actorId: 'admin-1', reason: 'second' });
    await suspendMember({ memberId: 'member-2', actorId: 'admin-1', reason: 'other-member' });

    const history = await listModerationHistory('member-1');

    expect(history).toHaveLength(2);
    // Newest first: reinstate ('second') before suspend ('first').
    expect(history[0]!.reason).toBe('second');
    expect(history[0]!.action).toBe('reinstated');
    expect(history[1]!.reason).toBe('first');
    expect(history[1]!.action).toBe('suspended');
    expect(history.every((e) => e.memberId === 'member-1')).toBe(true);
  });

  it('honours the take bound', async () => {
    seedUser({ id: 'member-1', status: 'active' });
    // 3 transitions (suspend / reinstate / suspend).
    await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: '1' });
    await reinstateMember({ memberId: 'member-1', actorId: 'admin-1', reason: '2' });
    await suspendMember({ memberId: 'member-1', actorId: 'admin-1', reason: '3' });

    const limited = await listModerationHistory('member-1', 2);
    expect(limited).toHaveLength(2);
    expect(limited[0]!.reason).toBe('3'); // newest
    expect(limited[1]!.reason).toBe('2');
  });

  it('returns an empty array for a member with no moderation history', async () => {
    const history = await listModerationHistory('never-moderated');
    expect(history).toEqual([]);
  });
});
