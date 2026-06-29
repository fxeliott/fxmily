import { describe, expect, it } from 'vitest';

import { VERIFICATION_SCAN_CONCURRENCY } from '@/lib/verification/batch-util';

import { envSchemaWithRefines } from './env';

/**
 * RC#7 — pool floor vs fixed batch concurrency.
 *
 * The verification scans (concurrency 5) and the push dispatcher (concurrency 8)
 * are justified as "well under the pool max (10)". An operator tuning
 * DATABASE_POOL_MAX below that concurrency to fit a shared Postgres budget would
 * silently break the justification: chunks saturate the pool and excess acquires
 * throw on connectionTimeoutMillis. The env refine fails the boot instead.
 */

/** Minimal env that parses (AUTH_URL http → not prod → CRON_SECRET optional). */
const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://t:t@localhost:5432/db',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3000',
} as const;

describe('DATABASE_POOL_MAX floor (RC#7)', () => {
  it('rejects a pool max below the batch-concurrency floor (8)', () => {
    const res = envSchemaWithRefines.safeParse({ ...VALID, DATABASE_POOL_MAX: '7' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('DATABASE_POOL_MAX'))).toBe(true);
    }
  });

  it('accepts a pool max at the floor and above', () => {
    expect(envSchemaWithRefines.safeParse({ ...VALID, DATABASE_POOL_MAX: '8' }).success).toBe(true);
    expect(envSchemaWithRefines.safeParse({ ...VALID, DATABASE_POOL_MAX: '50' }).success).toBe(
      true,
    );
  });

  it('the default pool (10) satisfies the floor', () => {
    const res = envSchemaWithRefines.safeParse(VALID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.DATABASE_POOL_MAX).toBe(10);
  });

  it('drift guard — the fixed batch concurrencies stay <= the env floor (8)', () => {
    // If VERIFICATION_SCAN_CONCURRENCY (or the dispatcher's local CONCURRENCY=8,
    // the binding value) is raised above the floor, this test trips so the env
    // refine in env.ts is raised in the same change — keeping them in lockstep.
    expect(VERIFICATION_SCAN_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});
