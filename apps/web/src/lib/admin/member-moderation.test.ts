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

type ModerationEventAction = 'suspended' | 'reinstated' | 'avatar_removed';

interface UserRow {
  id: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  tokenVersion: number;
  avatarKey: string | null;
}
interface EventRow {
  id: string;
  memberId: string;
  actorId: string | null;
  action: ModerationEventAction;
  reason: string | null;
  createdAt: Date;
}

const BASE = new Date('2026-06-30T08:00:00.000Z').getTime();

const store = vi.hoisted(() => {
  return {
    users: [] as UserRow[],
    events: [] as EventRow[],
    seq: 0,
    // Storage sweep + observability are mocked below; kept on the hoisted store
    // so a test can assert the best-effort file unlink / warning behaviour.
    storageDelete: vi.fn(async (_key: string): Promise<void> => {}),
    reportWarning: vi.fn(),
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
      // `removeMemberAvatar` reads the target with a `role:'member'` +
      // `avatarKey:{ not:null }` predicate before clearing it.
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; role?: string; avatarKey?: { not: null } };
          select?: unknown;
        }) => {
          const row = s.users.find(
            (u) =>
              u.id === where.id &&
              (where.role === undefined || u.role === where.role) &&
              (where.avatarKey === undefined ||
                (where.avatarKey.not === null && u.avatarKey !== null)),
          );
          return row ? { avatarKey: row.avatarKey } : null;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { avatarKey?: string | null } }) => {
          const row = s.users.find((u) => u.id === where.id);
          if (!row) throw new Error('Record to update not found.');
          if (data.avatarKey !== undefined) row.avatarKey = data.avatarKey;
          return { ...row };
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
            action: ModerationEventAction;
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
// `removeMemberAvatar` sweeps the stored file (best-effort) + reports a warning
// on failure; both are stubbed so the service runs without real I/O.
vi.mock('@/lib/storage', () => ({ selectStorage: () => ({ delete: store.storageDelete }) }));
vi.mock('@/lib/observability', () => ({ reportWarning: store.reportWarning }));

const { suspendMember, reinstateMember, removeMemberAvatar, listModerationHistory } =
  await import('./member-moderation');

function seedUser(overrides: Partial<UserRow> = {}): UserRow {
  const row: UserRow = {
    id: 'member-1',
    role: 'member',
    status: 'active',
    tokenVersion: 2,
    avatarKey: null,
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
  // Default sweep succeeds; a test overrides with `mockRejectedValueOnce`.
  store.storageDelete.mockReset();
  store.storageDelete.mockResolvedValue(undefined);
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
// removeMemberAvatar
// ---------------------------------------------------------------------------

describe('removeMemberAvatar', () => {
  it('clears avatarKey, appends an avatar_removed event, and sweeps the stored file', async () => {
    const user = seedUser({ avatarKey: 'avatars/member-1/photo.jpg' });

    const result = await removeMemberAvatar({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: 'Photo inappropriée',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(user.avatarKey).toBeNull(); // photo off the board immediately
    expect(user.status).toBe('active'); // account/ranking untouched
    expect(result.removedKey).toBe('avatars/member-1/photo.jpg');
    expect(result.event.action).toBe('avatar_removed');
    expect(result.event.reason).toBe('Photo inappropriée');
    expect(store.events).toHaveLength(1);
    // Best-effort file sweep ran with the cleared key.
    expect(store.storageDelete).toHaveBeenCalledWith('avatars/member-1/photo.jpg');
    expect(store.reportWarning).not.toHaveBeenCalled();
  });

  it('is a no_avatar no-op when the member has no photo — no event, no sweep', async () => {
    const user = seedUser({ avatarKey: null });

    const result = await removeMemberAvatar({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('no_avatar');
    expect(user.avatarKey).toBeNull();
    expect(store.events).toHaveLength(0);
    expect(store.storageDelete).not.toHaveBeenCalled();
  });

  it('refuses to touch an ADMIN row (role guard) — no_avatar, no event, no sweep', async () => {
    const admin = seedUser({
      id: 'admin-2',
      role: 'admin',
      avatarKey: 'avatars/admin-2/photo.jpg',
    });

    const result = await removeMemberAvatar({
      memberId: 'admin-2',
      actorId: 'admin-1',
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('no_avatar');
    expect(admin.avatarKey).toBe('avatars/admin-2/photo.jpg'); // never cleared
    expect(store.events).toHaveLength(0);
    expect(store.storageDelete).not.toHaveBeenCalled();
  });

  it('is a no_avatar no-op for a member that does not exist', async () => {
    const result = await removeMemberAvatar({
      memberId: 'ghost',
      actorId: 'admin-1',
      reason: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('no_avatar');
    expect(store.events).toHaveLength(0);
  });

  it('still succeeds (photo already off the board) when the file sweep fails — warning reported, not thrown', async () => {
    const user = seedUser({ avatarKey: 'avatars/member-1/photo.jpg' });
    store.storageDelete.mockRejectedValueOnce(new Error('disk unreachable'));

    const result = await removeMemberAvatar({
      memberId: 'member-1',
      actorId: 'admin-1',
      reason: null,
    });

    expect(result.ok).toBe(true); // DB is the source of truth; unlink is best-effort
    if (!result.ok) throw new Error('expected success');
    expect(user.avatarKey).toBeNull(); // cleared regardless of the sweep
    expect(store.events).toHaveLength(1);
    expect(store.reportWarning).toHaveBeenCalledTimes(1);
    expect(store.reportWarning).toHaveBeenCalledWith(
      'admin.member.avatar_removed',
      'storage_sweep_failed',
      expect.objectContaining({ userId: 'member-1', kind: 'avatar' }),
    );
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
