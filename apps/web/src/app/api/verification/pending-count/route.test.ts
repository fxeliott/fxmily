import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 15 — route handler tests for GET /api/verification/pending-count.
 *
 * This endpoint backs the `ProofAnalysisPoller` light poll on `/verification`.
 * We pin the auth gate (a logged-out or non-active member must never reach the
 * DB counter) and the happy path (count scoped to the session user, no-store).
 *
 * Mocking strategy mirrors `account/data/export/route.test.ts`: `@/auth` and
 * the service counter are mocked, the route is imported dynamically after the
 * mocks are registered.
 */

const authMock = vi.fn<(...args: unknown[]) => unknown>();
const countPendingProofsMock = vi.fn<(...args: unknown[]) => Promise<number>>();

vi.mock('@/auth', () => ({
  auth: authMock,
}));

vi.mock('@/lib/verification/service', () => ({
  countPendingProofs: countPendingProofsMock,
}));

const { GET } = await import('./route');

beforeEach(() => {
  authMock.mockReset();
  countPendingProofsMock.mockReset();
});

describe('GET /api/verification/pending-count — auth gate', () => {
  // Why this matters: a logged-out poll must never hit the DB counter.
  it('returns 401 when no session is present', async () => {
    authMock.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(countPendingProofsMock).not.toHaveBeenCalled();
  });

  // Why this matters: a suspended / soft-deleted member keeps a session briefly.
  // They must not be able to poll their queue after status flips.
  it('returns 401 when session.user.status is not active', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'suspended' } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(countPendingProofsMock).not.toHaveBeenCalled();
  });

  // Why this matters: a session object without an id (mid-auth edge) must not
  // be treated as authenticated.
  it('returns 401 when the session has no user id', async () => {
    authMock.mockResolvedValueOnce({ user: { status: 'active' } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(countPendingProofsMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/verification/pending-count — happy path', () => {
  // Why this matters: the count must be scoped to the SESSION user id (never a
  // client-supplied one), and returned as { pending: number } with no-store so
  // the poll never reads a cached stale value.
  it('returns 200 with the pending count scoped to the session user and no-store', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_ok', status: 'active' } });
    countPendingProofsMock.mockResolvedValueOnce(3);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 3 });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(countPendingProofsMock).toHaveBeenCalledWith('u_ok');
  });

  // Why this matters: zero pending is the steady state (nothing to wait for) —
  // the client stops polling on it, so it must be a clean 200 with pending: 0.
  it('returns 200 { pending: 0 } when nothing is pending', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_zero', status: 'active' } });
    countPendingProofsMock.mockResolvedValueOnce(0);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 0 });
  });
});
