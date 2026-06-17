import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real (unmocked) Prisma — the service's P2002 race guard checks
// `err instanceof Prisma.PrismaClientKnownRequestError`, so the test must throw
// a genuine instance (a bare `{ code: 'P2002' }` object would fail instanceof).
import { Prisma } from '@/generated/prisma/client';

/**
 * V2.5 — Service tests for the self-service access-request pipeline.
 *
 * Mocking strategy mirrors `lib/admin/admin-notes-service.test.ts`: we mock
 * `@/lib/db` so the service's branching logic is exercised, not Postgres. The
 * `$transaction` mock invokes its callback with a `tx` shaped like the mocked
 * `db` (the service uses the same model methods inside and outside the
 * transaction). We also mock `@/lib/auth/invitations` so token generation is
 * deterministic.
 */

// `vi.hoisted` lets us share the mock fns between the (hoisted) `vi.mock`
// factory and the test bodies without the "cannot access before init" TDZ
// error that bites plain top-level consts referenced from a hoisted factory.
const m = vi.hoisted(() => {
  const fns = {
    invitationFindUnique: vi.fn(),
    invitationCreate: vi.fn(),
    invitationUpdateMany: vi.fn(),
    invitationDeleteMany: vi.fn(),
    userFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    accessRequestCreate: vi.fn(),
    accessRequestFindFirst: vi.fn(),
    accessRequestFindUnique: vi.fn(),
    accessRequestFindMany: vi.fn(),
    accessRequestUpdate: vi.fn(),
    accessRequestUpdateMany: vi.fn(),
    accessRequestCount: vi.fn(),
  };
  return fns;
});

const {
  invitationCreate,
  invitationUpdateMany,
  invitationDeleteMany,
  userFindFirst,
  userFindUnique,
  accessRequestCreate,
  accessRequestFindFirst,
  accessRequestFindUnique,
  accessRequestFindMany,
  accessRequestUpdate,
  accessRequestUpdateMany,
} = m;

vi.mock('@/lib/db', () => {
  const tx = {
    user: { findFirst: m.userFindFirst, findUnique: m.userFindUnique },
    invitation: {
      findUnique: m.invitationFindUnique,
      create: m.invitationCreate,
      updateMany: m.invitationUpdateMany,
      deleteMany: m.invitationDeleteMany,
    },
    accessRequest: {
      create: m.accessRequestCreate,
      findFirst: m.accessRequestFindFirst,
      findUnique: m.accessRequestFindUnique,
      findMany: m.accessRequestFindMany,
      update: m.accessRequestUpdate,
      updateMany: m.accessRequestUpdateMany,
    },
  };
  return {
    db: {
      ...tx,
      accessRequest: { ...tx.accessRequest, count: m.accessRequestCount },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock('@/lib/auth/invitations', () => ({
  INVITATION_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  generateInvitationToken: vi.fn(() => 'plain-token-deterministic'),
  hashInvitationToken: vi.fn((t: string) => `hash:${t}`),
}));

import {
  AccessRequestNotFoundError,
  AccessRequestNotPendingError,
  AccessRequestUserExistsError,
  approveAccessRequest,
  createAccessRequest,
  listPendingAccessRequests,
  rejectAccessRequest,
  rollbackApproval,
} from './service';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createAccessRequest — dedup + no-enumeration
// ---------------------------------------------------------------------------

describe('createAccessRequest', () => {
  it('creates a row when no user and no pending request exist, with normalized email', async () => {
    userFindFirst.mockResolvedValue(null);
    accessRequestFindFirst.mockResolvedValue(null);
    accessRequestCreate.mockResolvedValue({ id: 'ar-1' });

    const result = await createAccessRequest({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: '  Eliot@FXMILYAPP.com ',
    });

    expect(result).toEqual({ ok: true, created: true });
    const arg = accessRequestCreate.mock.calls[0]?.[0] as {
      data: { firstName: string; lastName: string; email: string };
    };
    // Email lowercased + trimmed; names passed through (already sanitized at Zod).
    expect(arg.data).toEqual({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: 'eliot@fxmilyapp.com',
    });
  });

  it('does NOT create a duplicate when a pending request already exists, but STILL returns success (no enumeration)', async () => {
    userFindFirst.mockResolvedValue(null);
    accessRequestFindFirst.mockResolvedValue({ id: 'existing-pending' });

    const result = await createAccessRequest({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: 'eliot@fxmilyapp.com',
    });

    // Neutral success — caller can't tell a row already existed.
    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(accessRequestCreate).not.toHaveBeenCalled();
  });

  it('does NOT create a row when an active user already exists, but STILL returns success (no enumeration)', async () => {
    userFindFirst.mockResolvedValue({ id: 'user-1' });
    accessRequestFindFirst.mockResolvedValue(null);

    const result = await createAccessRequest({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: 'eliot@fxmilyapp.com',
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(accessRequestCreate).not.toHaveBeenCalled();
    // The user dedup query excludes soft-deleted accounts.
    const arg = userFindFirst.mock.calls[0]?.[0] as { where: { status: unknown } };
    expect(arg.where.status).toEqual({ not: 'deleted' });
  });

  it('treats a P2002 from a concurrent insert as a neutral dedup (partial-unique race guard)', async () => {
    // Both layers of the fast-path dedup pass (no user, no pending) — the two
    // concurrent submits both reach the insert; the DB partial UNIQUE index
    // `(email) WHERE status='pending'` lets only one win, the loser raises P2002.
    userFindFirst.mockResolvedValue(null);
    accessRequestFindFirst.mockResolvedValue(null);
    accessRequestCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await createAccessRequest({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: 'race@fxmilyapp.com',
    });

    // The loser of the race is treated exactly like an existing pending request:
    // neutral success (no enumeration), NOT created, NOT thrown.
    expect(result).toEqual({ ok: true, created: false });
    expect(accessRequestCreate).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-P2002 database error (never silently swallows real failures)', async () => {
    userFindFirst.mockResolvedValue(null);
    accessRequestFindFirst.mockResolvedValue(null);
    accessRequestCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Connection reset', {
        code: 'P1001',
        clientVersion: 'test',
      }),
    );

    await expect(
      createAccessRequest({ firstName: 'Eliot', lastName: 'Pena', email: 'boom@fxmilyapp.com' }),
    ).rejects.toThrow('Connection reset');
  });
});

// ---------------------------------------------------------------------------
// listPendingAccessRequests
// ---------------------------------------------------------------------------

describe('listPendingAccessRequests', () => {
  it('queries pending status oldest-first and serializes dates to ISO', async () => {
    accessRequestFindMany.mockResolvedValue([
      {
        id: 'ar-1',
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        status: 'pending',
        reviewedAt: null,
        reviewedById: null,
        invitationId: null,
        createdAt: new Date('2026-06-01T10:00:00Z'),
        updatedAt: new Date('2026-06-01T10:00:00Z'),
      },
    ]);

    const result = await listPendingAccessRequests();

    const arg = accessRequestFindMany.mock.calls[0]?.[0] as {
      where: { status: string };
      orderBy: { createdAt: string };
    };
    expect(arg.where).toEqual({ status: 'pending' });
    expect(arg.orderBy).toEqual({ createdAt: 'asc' });
    expect(result[0]?.createdAt).toBe('2026-06-01T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// approveAccessRequest — mints invitation + links it
// ---------------------------------------------------------------------------

describe('approveAccessRequest', () => {
  it('mints an invitation, invalidates prior ones, links it, and returns token + email', async () => {
    accessRequestFindUnique.mockResolvedValue({
      id: 'ar-1',
      status: 'pending',
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
    });
    userFindUnique.mockResolvedValue(null);
    invitationUpdateMany.mockResolvedValue({ count: 0 });
    invitationCreate.mockResolvedValue({ id: 'inv-1' });
    accessRequestUpdate.mockResolvedValue({});

    const result = await approveAccessRequest('ar-1', 'admin-1');

    // Invitation minted with the request's email + the admin as inviter.
    const createArg = invitationCreate.mock.calls[0]?.[0] as {
      data: { email: string; tokenHash: string; invitedById: string };
    };
    expect(createArg.data.email).toBe('eliot@fxmilyapp.com');
    expect(createArg.data.invitedById).toBe('admin-1');
    expect(createArg.data.tokenHash).toBe('hash:plain-token-deterministic');

    // Prior unused invitations invalidated (one active token per email).
    const updArg = invitationUpdateMany.mock.calls[0]?.[0] as {
      where: { email: string; usedAt: null };
    };
    expect(updArg.where.email).toBe('eliot@fxmilyapp.com');

    // Request flipped to approved + linked to the invitation.
    const reqUpdArg = accessRequestUpdate.mock.calls[0]?.[0] as {
      data: { status: string; reviewedById: string; invitationId: string };
    };
    expect(reqUpdArg.data.status).toBe('approved');
    expect(reqUpdArg.data.reviewedById).toBe('admin-1');
    expect(reqUpdArg.data.invitationId).toBe('inv-1');

    // Returns the plain token + recipient info for the email send.
    expect(result).toEqual({
      invitationId: 'inv-1',
      plainToken: 'plain-token-deterministic',
      expiresAt: expect.any(Date),
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
    });
  });

  it('throws AccessRequestNotFoundError for an unknown request', async () => {
    accessRequestFindUnique.mockResolvedValue(null);
    await expect(approveAccessRequest('nope', 'admin-1')).rejects.toBeInstanceOf(
      AccessRequestNotFoundError,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it('throws AccessRequestNotPendingError when the request is already resolved', async () => {
    accessRequestFindUnique.mockResolvedValue({
      id: 'ar-1',
      status: 'approved',
      email: 'x@y.com',
      firstName: 'X',
    });
    await expect(approveAccessRequest('ar-1', 'admin-1')).rejects.toBeInstanceOf(
      AccessRequestNotPendingError,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it('throws AccessRequestUserExistsError when a user already exists for the email', async () => {
    accessRequestFindUnique.mockResolvedValue({
      id: 'ar-1',
      status: 'pending',
      email: 'x@y.com',
      firstName: 'X',
    });
    userFindUnique.mockResolvedValue({ id: 'user-1' });
    await expect(approveAccessRequest('ar-1', 'admin-1')).rejects.toBeInstanceOf(
      AccessRequestUserExistsError,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rollbackApproval — delete-on-email-failure
// ---------------------------------------------------------------------------

describe('rollbackApproval', () => {
  it('deletes the invitation and reverts the request to pending', async () => {
    invitationDeleteMany.mockResolvedValue({ count: 1 });
    accessRequestUpdateMany.mockResolvedValue({ count: 1 });

    await rollbackApproval('ar-1', 'inv-1');

    expect(invitationDeleteMany).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
    const updArg = accessRequestUpdateMany.mock.calls[0]?.[0] as {
      where: { id: string; status: string };
      data: { status: string; invitationId: null };
    };
    expect(updArg.where).toEqual({ id: 'ar-1', status: 'approved' });
    expect(updArg.data.status).toBe('pending');
    expect(updArg.data.invitationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rejectAccessRequest
// ---------------------------------------------------------------------------

describe('rejectAccessRequest', () => {
  it('flips a pending request to rejected with reviewer metadata + returns the requester email/firstName (§26.4)', async () => {
    accessRequestFindUnique.mockResolvedValue({
      id: 'ar-1',
      status: 'pending',
      email: 'ana@example.com',
      firstName: 'Ana',
    });
    accessRequestUpdate.mockResolvedValue({ id: 'ar-1' });

    const result = await rejectAccessRequest('ar-1', 'admin-1');

    const arg = accessRequestUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { status: string; reviewedById: string };
    };
    expect(arg.where).toEqual({ id: 'ar-1' });
    expect(arg.data.status).toBe('rejected');
    expect(arg.data.reviewedById).toBe('admin-1');
    // Email recipient + greeting are carried back to the caller (refusal email).
    expect(result).toEqual({ email: 'ana@example.com', firstName: 'Ana' });
  });

  it('throws AccessRequestNotFoundError when the row is absent (no update, no email)', async () => {
    accessRequestFindUnique.mockResolvedValue(null);
    await expect(rejectAccessRequest('nope', 'admin-1')).rejects.toBeInstanceOf(
      AccessRequestNotFoundError,
    );
    expect(accessRequestUpdate).not.toHaveBeenCalled();
  });

  it('throws AccessRequestNotPendingError when the row exists but is already resolved', async () => {
    accessRequestFindUnique.mockResolvedValue({
      id: 'ar-1',
      status: 'approved',
      email: 'ana@example.com',
      firstName: 'Ana',
    });
    await expect(rejectAccessRequest('ar-1', 'admin-1')).rejects.toBeInstanceOf(
      AccessRequestNotPendingError,
    );
    expect(accessRequestUpdate).not.toHaveBeenCalled();
  });
});
