import { describe, expect, it } from 'vitest';

import { constantTimeEqual } from './constant-time';

/**
 * Pins the shared constant-time comparator under its OWN name. It already gets
 * exercised transitively (admin-token.test.ts via verifyAdminToken, and the
 * cron route tests via the X-Cron-Secret gate), but this guards the helper's
 * two load-bearing properties directly so a refactor of either caller can't
 * silently regress them:
 *   1. correctness — equal accepted, any difference rejected;
 *   2. the length-leak fix — because both sides are hashed to a fixed 32-byte
 *      SHA-256 digest first, `timingSafeEqual` never sees mismatched lengths and
 *      therefore CANNOT throw the `RangeError` it raises on unequal-length
 *      buffers. A naive `timingSafeEqual(provided, expected)` would crash the
 *      route (→ 500, not a clean 401) the instant an attacker sends a token of
 *      the wrong length. These cases lock that in.
 */
describe('constantTimeEqual', () => {
  it('returns true for identical secrets', () => {
    expect(constantTimeEqual('s3cr3t-value', 's3cr3t-value')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false for same-length but different secrets', () => {
    expect(constantTimeEqual('aaaaaa', 'bbbbbb')).toBe(false);
  });

  it('returns false — never throws — for different-length secrets', () => {
    expect(() => constantTimeEqual('short', 'a-much-longer-secret-value')).not.toThrow();
    expect(constantTimeEqual('short', 'a-much-longer-secret-value')).toBe(false);
    expect(constantTimeEqual('a-much-longer-secret-value', 'short')).toBe(false);
    expect(constantTimeEqual('', 'non-empty')).toBe(false);
    expect(constantTimeEqual('non-empty', '')).toBe(false);
  });

  it('is sensitive to a single-character difference (no early-exit shortcut)', () => {
    expect(constantTimeEqual('token-1234567890', 'token-1234567891')).toBe(false);
  });
});
