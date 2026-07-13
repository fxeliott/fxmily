import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J1 hardening — Tests for POST /api/uploads (Content-Length pre-check).
 *
 * The 413 pre-check (J1) rejects an oversized body from the client-supplied
 * Content-Length header BEFORE `req.formData()` buffers the whole multipart
 * stream into memory. What we pin:
 *   - 401 when no session / status !== 'active' (nothing downstream runs)
 *   - 413 when Content-Length exceeds MAX_PROOF_INPUT_BYTES + the multipart
 *     overhead allowance — WITHOUT calling req.formData()
 *   - the pre-check is an early-exit hint only: at the exact threshold, or
 *     without a Content-Length header, the request reaches req.formData()
 *     (mocked to throw → 400 invalid_form proves the pass-through)
 *
 * Mock strategy: auth/db/audit/rate-limit/storage/normalize-image are faked
 * (none is exercised past the pre-check); `@/lib/storage/types` and
 * `@/lib/schemas/verification` stay real (dependency-light, no env import).
 */

const MAX_PROOF_INPUT_BYTES = 20 * 1024 * 1024; // 20 MiB — mirrors route.ts
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const PRECHECK_THRESHOLD = MAX_PROOF_INPUT_BYTES + MULTIPART_OVERHEAD_BYTES;

const authMock = vi.fn<() => Promise<unknown>>();
const consumeMock = vi.fn<(key: string) => { allowed: boolean; retryAfterMs: number }>();
const logAuditMock = vi.fn<(...a: unknown[]) => Promise<unknown>>();

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db', () => ({ db: {} }));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
  resolveUploadAuditAction: () => 'trade.screenshot.uploaded',
}));

vi.mock('@/lib/rate-limit/token-bucket', () => ({
  uploadLimiter: { consume: consumeMock },
}));

vi.mock('@/lib/storage', () => ({ selectStorage: vi.fn() }));

vi.mock('@/lib/uploads/normalize-image', () => ({
  isHeic: vi.fn(() => false),
  normalizeProofImage: vi.fn(),
  sniffProofInputFormat: vi.fn(() => null),
}));

const { POST } = await import('./route');

function activeSession() {
  return { user: { id: 'user1', role: 'member', status: 'active' } };
}

/**
 * Plain-object Request stand-in: undici's Request constructor treats
 * Content-Length as a forbidden header (silently dropped), so a real
 * `new Request(...)` cannot carry the header under test. The route only
 * touches `req.headers.get()` and `req.formData()` before the code paths
 * pinned here.
 */
function makeReq(contentLength: string | null) {
  const formData = vi
    .fn<() => Promise<FormData>>()
    .mockRejectedValue(new TypeError('multipart parse failed (test)'));
  const req = {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null),
    },
    formData,
  } as unknown as Request;
  return { req, formData };
}

beforeEach(() => {
  authMock.mockReset();
  consumeMock.mockReset();
  logAuditMock.mockReset();
  consumeMock.mockReturnValue({ allowed: true, retryAfterMs: 0 });
});

describe('POST /api/uploads — session gate', () => {
  it('returns 401 when there is no session (nothing downstream runs)', async () => {
    // Arrange
    authMock.mockResolvedValue(null);
    const { req, formData } = makeReq('123');

    // Act
    const res = await POST(req);

    // Assert
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(consumeMock).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
  });

  it('returns 401 when the session user is not active', async () => {
    // Arrange
    authMock.mockResolvedValue({ user: { id: 'user1', role: 'member', status: 'suspended' } });
    const { req, formData } = makeReq('123');

    // Act
    const res = await POST(req);

    // Assert
    expect(res.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
  });
});

describe('POST /api/uploads — Content-Length pre-check (J1 hardening)', () => {
  it('returns 413 WITHOUT buffering the body when Content-Length exceeds cap + overhead', async () => {
    // Arrange
    authMock.mockResolvedValue(activeSession());
    const { req, formData } = makeReq(String(PRECHECK_THRESHOLD + 1)); // 21_037_057

    // Act
    const res = await POST(req);

    // Assert — early-exit before req.formData()
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large', limit: MAX_PROOF_INPUT_BYTES });
    expect(formData).not.toHaveBeenCalled();
  });

  it('lets a body at exactly the threshold reach formData() (early-exit hint only)', async () => {
    // Arrange
    authMock.mockResolvedValue(activeSession());
    const { req, formData } = makeReq(String(PRECHECK_THRESHOLD)); // 21_037_056

    // Act
    const res = await POST(req);

    // Assert — pre-check passed, the (mocked) multipart parse failure answers 400
    expect(formData).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_form' });
  });

  it('lets a request without Content-Length reach formData()', async () => {
    // Arrange
    authMock.mockResolvedValue(activeSession());
    const { req, formData } = makeReq(null);

    // Act
    const res = await POST(req);

    // Assert
    expect(formData).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
  });
});
