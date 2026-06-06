/**
 * Onboarding chain integration tests (Prisma-mocked) — DoD §29 #1 "testé en
 * réel" for the account-creation path.
 *
 * Closes the documented zero-coverage gap: `completeOnboarding`
 * (`lib/auth/onboarding.ts`) + the invitation helpers (`lib/auth/invitations.ts`)
 * had NO test exercising the real signup → active-member flow. This suite drives
 * the chain end-to-end against a small in-memory Prisma stand-in so the SHA-256
 * hashed token produced by `createInvitation` is actually consumed by
 * `completeOnboarding`:
 *
 *   create invitation (hashed token)  → consume via completeOnboarding
 *     → assert User created role='member' status='active'
 *     → assert invitation marked consumed (usedAt set)
 *     → idempotent: re-consuming the same token fails (no double-create)
 *     → invalid / expired / unknown token rejected
 *
 * Mocking style mirrors `authorize-credentials.test.ts` (mock `@/lib/db`,
 * `@/lib/auth/audit`, `@/lib/auth/password`); the invitation hashing + the
 * onboarding branching logic stay REAL so we test the actual contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- In-memory Prisma stand-in --------------------------------------------
// Two tables are enough for this chain: invitations + users. The store is
// reset per-test. `$transaction` runs the callback against the same `db`
// surface (the service only uses `tx.invitation`/`tx.user` methods we define).

interface InvitationRow {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  invitedById: string;
}
interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  role: string;
  status: string;
}

// `vi.hoisted` runs before the (also hoisted) `vi.mock` factories, so the store
// + db stand-in are initialised in time for the mock factory to reference them.
const store = vi.hoisted(() => {
  return {
    invitations: [] as InvitationRow[],
    users: [] as UserRow[],
    invitationSeq: 0,
    userSeq: 0,
  };
});

function buildDbApi(s: typeof store) {
  const api = {
    invitation: {
      create: vi.fn(async ({ data }: { data: Omit<InvitationRow, 'id' | 'usedAt'> }) => {
        const row: InvitationRow = { id: `inv-${++s.invitationSeq}`, usedAt: null, ...data };
        s.invitations.push(row);
        return { id: row.id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const found = s.invitations.find(
          (i) =>
            (where.tokenHash !== undefined && i.tokenHash === where.tokenHash) ||
            (where.id !== undefined && i.id === where.id),
        );
        return found ? { ...found } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { usedAt: Date } }) => {
        const row = s.invitations.find((i) => i.id === where.id);
        if (!row) throw new Error('invitation not found');
        row.usedAt = data.usedAt;
        return { ...row };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        const found = s.users.find((u) => u.email === where.email);
        return found ? { id: found.id } : null;
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<UserRow, 'id'> & { consentRgpdAt: Date; emailVerified: Date };
        }) => {
          const row: UserRow = {
            id: `user-${++s.userSeq}`,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            passwordHash: data.passwordHash,
            role: data.role,
            status: data.status,
          };
          s.users.push(row);
          return { id: row.id, email: row.email };
        },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: typeof api) => Promise<unknown>) => cb(api)),
  };
  return api;
}

vi.mock('@/lib/db', () => ({ db: buildDbApi(store) }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
}));

import { completeOnboarding } from './onboarding';
import { createInvitation, findInvitationByToken, INVITATION_TTL_MS } from './invitations';

const baseCompletion = {
  firstName: 'Alice',
  lastName: 'Martin',
  password: 'Sup3r-Secret-Pwd!2026',
  consentRgpdAt: new Date('2026-06-06T10:00:00.000Z'),
};

beforeEach(() => {
  store.invitations.length = 0;
  store.users.length = 0;
  store.invitationSeq = 0;
  store.userSeq = 0;
  vi.clearAllMocks();
});

describe('onboarding chain — create invitation → consume → active member', () => {
  it('creates a member with role=member status=active and marks the invitation consumed', async () => {
    const { plainToken, invitationId } = await createInvitation({
      email: 'Alice@Fxmily.local',
      invitedById: 'admin-1',
    });

    // Sanity: the plain token is never stored; only its hash lands in the row.
    expect(store.invitations[0]?.tokenHash).not.toBe(plainToken);
    expect(store.invitations[0]?.email).toBe('alice@fxmily.local'); // lowercased + trimmed

    const result = await completeOnboarding({ plainToken, ...baseCompletion });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected onboarding to succeed');
    expect(result.email).toBe('alice@fxmily.local');

    // User created as a fully-active member.
    expect(store.users).toHaveLength(1);
    const created = store.users[0]!;
    expect(created.role).toBe('member');
    expect(created.status).toBe('active');
    expect(created.email).toBe('alice@fxmily.local');
    expect(created.passwordHash).toBe('hashed:Sup3r-Secret-Pwd!2026');

    // Invitation marked consumed (usedAt set).
    const inv = store.invitations.find((i) => i.id === invitationId)!;
    expect(inv.usedAt).not.toBeNull();
  });

  it('is idempotent: re-consuming the SAME token fails with already_used and creates no second user', async () => {
    const { plainToken } = await createInvitation({
      email: 'bob@fxmily.local',
      invitedById: 'admin-1',
    });

    const first = await completeOnboarding({ plainToken, ...baseCompletion });
    expect(first.ok).toBe(true);
    expect(store.users).toHaveLength(1);

    const second = await completeOnboarding({ plainToken, ...baseCompletion });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected second consume to fail');
    expect(second.reason).toBe('already_used');

    // No double-create.
    expect(store.users).toHaveLength(1);
  });

  it('rejects an unknown token (invalid_token, no user created)', async () => {
    const result = await completeOnboarding({
      plainToken: 'this-token-was-never-issued-000000',
      ...baseCompletion,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('invalid_token');
    expect(store.users).toHaveLength(0);
  });

  it('rejects an expired token (expired, no user created)', async () => {
    // ttlMs negative → expiresAt already in the past.
    const { plainToken } = await createInvitation({
      email: 'carol@fxmily.local',
      invitedById: 'admin-1',
      ttlMs: -1000,
    });

    const result = await completeOnboarding({ plainToken, ...baseCompletion });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('expired');
    expect(store.users).toHaveLength(0);
  });

  it('findInvitationByToken round-trips a freshly created valid token', async () => {
    const { plainToken, invitationId } = await createInvitation({
      email: 'dave@fxmily.local',
      invitedById: 'admin-1',
    });
    const lookup = await findInvitationByToken(plainToken);
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) throw new Error('expected lookup ok');
    expect(lookup.invitation.id).toBe(invitationId);
    expect(lookup.invitation.email).toBe('dave@fxmily.local');
  });

  it('findInvitationByToken reports already_used after consumption', async () => {
    const { plainToken } = await createInvitation({
      email: 'erin@fxmily.local',
      invitedById: 'admin-1',
    });
    await completeOnboarding({ plainToken, ...baseCompletion });

    const lookup = await findInvitationByToken(plainToken);
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error('expected lookup err');
    expect(lookup.reason).toBe('already_used');
  });

  it('createInvitation sets expiresAt to now + INVITATION_TTL_MS (7 days) by default', async () => {
    const before = Date.now();
    const { expiresAt } = await createInvitation({
      email: 'frank@fxmily.local',
      invitedById: 'admin-1',
    });
    const after = Date.now();
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + INVITATION_TTL_MS - 50);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + INVITATION_TTL_MS + 50);
  });
});
