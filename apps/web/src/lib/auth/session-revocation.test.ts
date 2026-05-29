import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JWT } from 'next-auth/jwt';

/**
 * J4 (security T2-1) — unit tests for the JWT session-revocation logic.
 *
 * `applyRevocationCheck` is pure (no I/O). `refreshAndCheckToken` is the thin
 * DB orchestrator; we mock `@/lib/db` + `@/lib/observability` so the branching
 * (revoke / refresh / fail-open) is what we exercise, not the real Prisma
 * client. Mirrors the mocking strategy of `authorize-credentials.test.ts`.
 */

const dbUserFindUniqueMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportWarningMock = vi.fn<(...args: unknown[]) => void>();

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: dbUserFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/observability', () => ({
  reportWarning: reportWarningMock,
  // Other observability exports the SUT doesn't use — stub so any transitive
  // import doesn't blow up the module graph.
  reportError: vi.fn(),
  reportInfo: vi.fn(),
  reportBreadcrumb: vi.fn(),
}));

const { applyRevocationCheck, refreshAndCheckToken } = await import('./session-revocation');

/** Build a minimal JWT fixture with the Fxmily claims. */
function makeToken(overrides: Partial<JWT> = {}): JWT {
  return {
    sub: 'usr_1',
    role: 'member',
    status: 'active',
    timezone: 'Europe/Paris',
    tokenVersion: 0,
    ...overrides,
  } as JWT;
}

beforeEach(() => {
  dbUserFindUniqueMock.mockReset();
  reportWarningMock.mockReset();
});

describe('applyRevocationCheck (pure)', () => {
  it('revokes (returns null) when the user row is gone', () => {
    expect(applyRevocationCheck(makeToken(), null)).toBeNull();
  });

  it('revokes when the DB tokenVersion is ahead of the claim (explicit bump)', () => {
    const token = makeToken({ tokenVersion: 0 });
    expect(
      applyRevocationCheck(token, { tokenVersion: 1, status: 'active', role: 'member' }),
    ).toBeNull();
  });

  it('keeps the session when tokenVersion matches', () => {
    const token = makeToken({ tokenVersion: 2 });
    const result = applyRevocationCheck(token, {
      tokenVersion: 2,
      status: 'active',
      role: 'member',
    });
    expect(result).not.toBeNull();
    expect(result?.tokenVersion).toBe(2);
  });

  it('refreshes status + role from the DB on the happy path (defense in depth)', () => {
    const token = makeToken({ tokenVersion: 0, status: 'active', role: 'member' });
    const result = applyRevocationCheck(token, {
      tokenVersion: 0,
      status: 'suspended',
      role: 'admin',
    });
    expect(result?.status).toBe('suspended');
    expect(result?.role).toBe('admin');
  });

  it('preserves unrelated claims (sub, timezone) when refreshing', () => {
    const token = makeToken({ sub: 'usr_42', timezone: 'America/New_York', tokenVersion: 3 });
    const result = applyRevocationCheck(token, {
      tokenVersion: 3,
      status: 'active',
      role: 'member',
    });
    expect(result?.sub).toBe('usr_42');
    expect(result?.timezone).toBe('America/New_York');
  });

  it('backward-compat: a legacy token with no tokenVersion claim coalesces to 0 and survives when DB is still 0', () => {
    const legacy = makeToken();
    delete (legacy as { tokenVersion?: number }).tokenVersion;
    const result = applyRevocationCheck(legacy, {
      tokenVersion: 0,
      status: 'active',
      role: 'member',
    });
    expect(result).not.toBeNull();
    expect(result?.tokenVersion).toBe(0);
  });

  it('backward-compat: a legacy token (no claim) IS revoked once the DB counter is bumped to 1', () => {
    const legacy = makeToken();
    delete (legacy as { tokenVersion?: number }).tokenVersion;
    expect(
      applyRevocationCheck(legacy, { tokenVersion: 1, status: 'active', role: 'member' }),
    ).toBeNull();
  });
});

describe('refreshAndCheckToken (DB orchestrator)', () => {
  it('returns the token untouched without hitting the DB when there is no sub', async () => {
    const token = makeToken();
    delete (token as { sub?: string }).sub;
    const result = await refreshAndCheckToken(token);
    expect(result).toBe(token);
    expect(dbUserFindUniqueMock).not.toHaveBeenCalled();
  });

  it('re-reads the revocation snapshot for the token subject', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce({
      tokenVersion: 0,
      status: 'active',
      role: 'member',
    });
    await refreshAndCheckToken(makeToken({ sub: 'usr_77' }));
    expect(dbUserFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'usr_77' },
      select: { tokenVersion: true, status: true, role: true },
    });
  });

  it('revokes (returns null) when the user row no longer exists', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce(null);
    expect(await refreshAndCheckToken(makeToken())).toBeNull();
  });

  it('revokes when the DB tokenVersion is ahead of the claim', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce({
      tokenVersion: 5,
      status: 'active',
      role: 'member',
    });
    expect(await refreshAndCheckToken(makeToken({ tokenVersion: 4 }))).toBeNull();
  });

  it('fails open (returns the token) and warns when the DB read throws', async () => {
    dbUserFindUniqueMock.mockRejectedValueOnce(new Error('connection reset'));
    const token = makeToken();
    const result = await refreshAndCheckToken(token);
    expect(result).toBe(token);
    expect(reportWarningMock).toHaveBeenCalledWith(
      'auth.session-revocation',
      'db_refresh_failed_fail_open',
      expect.objectContaining({ errorName: 'Error' }),
    );
  });
});
