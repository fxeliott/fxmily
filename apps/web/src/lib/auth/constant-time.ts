import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time secret comparison (CWE-208). Hashes both sides to a fixed
 * 32-byte SHA-256 digest first so `timingSafeEqual` walks the same number of
 * bytes regardless of input length (sidesteps the length-leak pitfall flagged
 * by Cloudflare's timingSafeEqual guide). Shared by the cron `X-Cron-Secret`
 * gate (16 routes) and the admin-batch `X-Admin-Token` gate (lib/auth/admin-token.ts).
 */
export function constantTimeEqual(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
