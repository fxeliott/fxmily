import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 §33.4 / J1 (ADR-006) — Tests for GET /api/admin/verification-batch/proof-image.
 *
 * The R2 read-fallback (commit 7a10bbb2) landed with 0 HTTP-handler coverage.
 * These tests pin the admin-token guard short-circuit, the proofId validation,
 * the DB lookup outcomes (404 / 410) and the local→R2 read fallback.
 *
 * What we pin :
 *   - guard returns a NextResponse → the handler returns it verbatim (no DB hit)
 *   - 400 on a missing / malformed proofId
 *   - 404 when the proof row is absent (soft-deleted member scoping)
 *   - 410 when filePurgedAt is set
 *   - 200 local read (Content-Type + Content-Length + Cache-Control)
 *   - not_found local + R2 configured → 200 served from R2 (Content-Length omitted on null size)
 *   - not_found local + R2 NOT configured → 404
 *   - POST → 405
 *
 * Mock strategy (task-critical) : `@/lib/storage` mocks ONLY isR2Configured +
 * openR2ReadStream, re-exporting the REAL StorageError via vi.importActual so
 * the handler's `err instanceof StorageError` branch stays intact.
 */

const VALID_PROOF_ID = 'proof0001abcdef';
const FILE_KEY = 'proofs/clsownermember0000000001/abcdefghijklmnopqrstuvwxyz012345.jpg';

const requireTokenMock = vi.fn<(...a: unknown[]) => unknown>();
const findFirstMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const isR2ConfiguredMock = vi.fn<() => boolean>();
const openR2ReadStreamMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const openLocalReadStreamMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();

vi.mock('@/lib/auth/admin-token', () => ({
  requireVerificationAdminToken: requireTokenMock,
}));

vi.mock('@/lib/db', () => ({
  db: { mt5AccountProof: { findFirst: findFirstMock } },
}));

vi.mock('@/lib/storage/local', () => ({
  openLocalReadStream: openLocalReadStreamMock,
}));

vi.mock('@/lib/storage', async () => {
  const types = await vi.importActual<typeof import('@/lib/storage/types')>('@/lib/storage/types');
  return {
    StorageError: types.StorageError,
    isR2Configured: isR2ConfiguredMock,
    openR2ReadStream: openR2ReadStreamMock,
  };
});

const { GET, POST } = await import('./route');
const { StorageError } = await import('@/lib/storage');

function makeReq(proofId?: string): Request {
  const base = 'https://app.fxmilyapp.com/api/admin/verification-batch/proof-image';
  const url = proofId === undefined ? base : `${base}?proofId=${proofId}`;
  return new Request(url, { method: 'GET' });
}

function localImage(ext: 'jpg' | 'png' | 'webp', size: number | null) {
  return { stream: Readable.from([Buffer.from('img-bytes')]), size, ext };
}

beforeEach(() => {
  requireTokenMock.mockReset();
  findFirstMock.mockReset();
  isR2ConfiguredMock.mockReset();
  openR2ReadStreamMock.mockReset();
  openLocalReadStreamMock.mockReset();
});

describe('GET /api/admin/verification-batch/proof-image — token guard', () => {
  it('returns the guard response verbatim and never touches the DB', async () => {
    // Arrange — guard rejects (e.g. missing/invalid X-Admin-Token → 401)
    requireTokenMock.mockReturnValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/verification-batch/proof-image — proofId validation', () => {
  it('returns 400 when proofId is missing', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);

    // Act
    const res = await GET(makeReq(undefined));

    // Assert
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_proof_id');
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('returns 400 when proofId does not match the id regex', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);

    // Act — uppercase + too short fails /^[a-z0-9]{8,40}$/
    const res = await GET(makeReq('BAD'));

    // Assert
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_proof_id');
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/verification-batch/proof-image — DB lookup outcomes', () => {
  it('returns 404 when the proof row is absent', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);
    findFirstMock.mockResolvedValue(null);

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('proof_not_found');
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });

  it('returns 410 when the proof screenshot was purged', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);
    findFirstMock.mockResolvedValue({ fileKey: FILE_KEY, filePurgedAt: new Date('2026-01-01') });

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('proof_purged');
    expect(openLocalReadStreamMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/verification-batch/proof-image — local read', () => {
  it('returns 200 streaming the local file with Content-Type, Content-Length and no-store', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);
    findFirstMock.mockResolvedValue({ fileKey: FILE_KEY, filePurgedAt: null });
    openLocalReadStreamMock.mockResolvedValue(localImage('jpg', 999));

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe('999');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(openR2ReadStreamMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/verification-batch/proof-image — R2 fallback (ADR-006)', () => {
  it('returns 200 from R2 when local is not_found and R2 is configured (omits Content-Length on null size)', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);
    findFirstMock.mockResolvedValue({ fileKey: FILE_KEY, filePurgedAt: null });
    openLocalReadStreamMock.mockRejectedValue(new StorageError('missing', 'not_found'));
    isR2ConfiguredMock.mockReturnValue(true);
    openR2ReadStreamMock.mockResolvedValue({
      stream: new ReadableStream(),
      size: null,
      ext: 'png',
    });

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBeNull();
    expect(openR2ReadStreamMock).toHaveBeenCalledWith(FILE_KEY);
  });

  it('returns 404 when local is not_found and R2 is NOT configured', async () => {
    // Arrange
    requireTokenMock.mockReturnValue(null);
    findFirstMock.mockResolvedValue({ fileKey: FILE_KEY, filePurgedAt: null });
    openLocalReadStreamMock.mockRejectedValue(new StorageError('missing', 'not_found'));
    isR2ConfiguredMock.mockReturnValue(false);

    // Act
    const res = await GET(makeReq(VALID_PROOF_ID));

    // Assert
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('file_missing');
    expect(openR2ReadStreamMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/verification-batch/proof-image', () => {
  it('returns 405 method_not_allowed', async () => {
    // Act
    const res = await POST();

    // Assert
    expect(res.status).toBe(405);
    expect((await res.json()).error).toBe('method_not_allowed');
  });
});
