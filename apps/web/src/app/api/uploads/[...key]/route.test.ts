import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J1 (ADR-006) — Tests for GET /api/uploads/[...key].
 *
 * The R2 read-fallback (commit 7a10bbb2) landed with 0 HTTP-handler coverage.
 * These tests pin the session gate, per-prefix ownership, the local-first
 * read and the local→R2 fallback on `not_found`.
 *
 * What we pin :
 *   - 401 when no session / status !== 'active'
 *   - 400 on an unparseable storage key
 *   - 403 when a member reads another member's trade screenshot
 *   - 200 local read (Content-Type + Content-Length from openLocalReadStream)
 *   - not_found local + R2 NOT configured        → 404
 *   - not_found local + R2 configured            → 200 served from R2
 *     (Content-Length OMITTED when size === null)
 *   - not_found local AND not_found R2           → 404
 *   - avatar is cross-member readable by any active member → 200
 *
 * Mock strategy (task-critical) :
 *   - `@/lib/storage` mocks ONLY isR2Configured + openR2ReadStream and
 *     re-exports the REAL StorageError + parseStorageKey via vi.importActual
 *     (the handler does `err instanceof StorageError` and parses real keys —
 *     a class mock would break the instanceof branch).
 *   - local absence is simulated by rejecting openLocalReadStream with the
 *     REAL StorageError('…', 'not_found').
 */

const OWNER_ID = 'clsownermember0000000001';
const OTHER_ID = 'clsothermember0000000002';
const FILE = 'abcdefghijklmnopqrstuvwxyz012345'; // nanoid32 shape [A-Za-z0-9_-]{32}

const tradeKey = (userId: string) => `trades/${userId}/${FILE}.jpg`;
const avatarKey = (userId: string) => `avatars/${userId}/${FILE}.webp`;

const authMock = vi.fn<() => Promise<unknown>>();
const isR2ConfiguredMock = vi.fn<() => boolean>();
const openR2ReadStreamMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const openLocalReadStreamMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const tradeFindUniqueMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const trainingTradeFindUniqueMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db', () => ({
  db: {
    trade: { findUnique: tradeFindUniqueMock },
    trainingTrade: { findUnique: trainingTradeFindUniqueMock },
  },
}));

vi.mock('@/lib/storage/local', () => ({
  openLocalReadStream: openLocalReadStreamMock,
}));

vi.mock('@/lib/storage', async () => {
  // Re-export the REAL StorageError + parseStorageKey (types.ts + keys.ts are
  // dependency-light: no server-only, no env). Only the two R2 seams are faked.
  const types = await vi.importActual<typeof import('@/lib/storage/types')>('@/lib/storage/types');
  const keys = await vi.importActual<typeof import('@/lib/storage/keys')>('@/lib/storage/keys');
  return {
    StorageError: types.StorageError,
    parseStorageKey: keys.parseStorageKey,
    isR2Configured: isR2ConfiguredMock,
    openR2ReadStream: openR2ReadStreamMock,
  };
});

const { GET } = await import('./route');
const { StorageError } = await import('@/lib/storage');

interface SessionUserOverrides {
  id?: string;
  status?: string;
  role?: string;
}

function sessionUser(overrides: SessionUserOverrides = {}) {
  return {
    user: {
      id: overrides.id ?? OWNER_ID,
      status: overrides.status ?? 'active',
      role: overrides.role ?? 'member',
    },
  };
}

function ctx(key: string) {
  return { params: Promise.resolve({ key: key.split('/') }) };
}

const REQ = new Request('http://localhost/api/uploads/x');

function localImage(ext: 'jpg' | 'png' | 'webp', size: number | null) {
  return { stream: Readable.from([Buffer.from('img-bytes')]), size, ext };
}

beforeEach(() => {
  authMock.mockReset();
  isR2ConfiguredMock.mockReset();
  openR2ReadStreamMock.mockReset();
  openLocalReadStreamMock.mockReset();
  tradeFindUniqueMock.mockReset();
  trainingTradeFindUniqueMock.mockReset();
});

describe('GET /api/uploads/[...key] — session gate', () => {
  it('returns 401 when there is no session', async () => {
    // Arrange
    authMock.mockResolvedValue(null);

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(401);
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the session user is not active', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser({ status: 'suspended' }));

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(401);
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploads/[...key] — key parsing + ownership', () => {
  it('returns 400 when the storage key is unparseable', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser());

    // Act
    const res = await GET(REQ, ctx('garbage/nope.txt') as never);

    // Assert
    expect(res.status).toBe(400);
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a member reads another member trade screenshot', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser({ id: OWNER_ID, role: 'member' }));

    // Act — key path-owner is OTHER_ID, requester is OWNER_ID
    const res = await GET(REQ, ctx(tradeKey(OTHER_ID)) as never);

    // Assert
    expect(res.status).toBe(403);
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });

  it('lets any active member read another member avatar cross-member (200)', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser({ id: OWNER_ID, role: 'member' }));
    openLocalReadStreamMock.mockResolvedValue(localImage('webp', 42));

    // Act — avatar path-owner is OTHER_ID; avatars are deliberately public to members
    const res = await GET(REQ, ctx(avatarKey(OTHER_ID)) as never);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });
});

describe('GET /api/uploads/[...key] — local read', () => {
  it('returns 200 streaming the local file with Content-Type + Content-Length', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser());
    openLocalReadStreamMock.mockResolvedValue(localImage('jpg', 1234));

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe('1234');
    expect(openR2ReadStreamMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploads/[...key] — R2 fallback (ADR-006)', () => {
  it('returns 404 when local is not_found and R2 is NOT configured', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser());
    openLocalReadStreamMock.mockRejectedValue(new StorageError('missing', 'not_found'));
    isR2ConfiguredMock.mockReturnValue(false);

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(404);
    expect(openR2ReadStreamMock).not.toHaveBeenCalled();
  });

  it('returns 200 from R2 when local is not_found and R2 is configured (omits Content-Length on null size)', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser());
    openLocalReadStreamMock.mockRejectedValue(new StorageError('missing', 'not_found'));
    isR2ConfiguredMock.mockReturnValue(true);
    openR2ReadStreamMock.mockResolvedValue({
      stream: new ReadableStream(),
      size: null,
      ext: 'png',
    });

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBeNull();
    expect(openR2ReadStreamMock).toHaveBeenCalledWith(tradeKey(OWNER_ID));
  });

  it('returns 404 when local AND R2 both report not_found', async () => {
    // Arrange
    authMock.mockResolvedValue(sessionUser());
    openLocalReadStreamMock.mockRejectedValue(new StorageError('missing', 'not_found'));
    isR2ConfiguredMock.mockReturnValue(true);
    openR2ReadStreamMock.mockRejectedValue(new StorageError('gone', 'not_found'));

    // Act
    const res = await GET(REQ, ctx(tradeKey(OWNER_ID)) as never);

    // Assert
    expect(res.status).toBe(404);
    expect(openR2ReadStreamMock).toHaveBeenCalledTimes(1);
  });
});
