import { describe, expect, it } from 'vitest';

import { envSchemaWithRefines } from './env';

/**
 * 2026-06-29 A-Z deep audit — driver-level scale knobs feeding `db.ts`
 * (the client-side dead-socket backstop + pool-connection rotation). Locks the
 * defaults and the one cross-knob invariant db.ts/env.ts comments rely on:
 * the CLIENT-side `query_timeout` must sit ABOVE the SERVER-side
 * `statement_timeout` so the server aborts a LIVE socket first and the client
 * timeout only reaps a DEAD one.
 */

/** Minimal env that parses (AUTH_URL http → not prod → CRON_SECRET optional). */
const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://t:t@localhost:5432/db',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3000',
} as const;

describe('DATABASE driver timeout knobs', () => {
  it('defaults: query_timeout 35s, max_lifetime 1800s', () => {
    const res = envSchemaWithRefines.safeParse(VALID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.DATABASE_QUERY_TIMEOUT_MS).toBe(35_000);
      expect(res.data.DATABASE_MAX_LIFETIME_S).toBe(1_800);
    }
  });

  it('client query_timeout default sits ABOVE the server statement_timeout default', () => {
    const res = envSchemaWithRefines.safeParse(VALID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.DATABASE_QUERY_TIMEOUT_MS).toBeGreaterThan(
        res.data.DATABASE_STATEMENT_TIMEOUT_MS,
      );
    }
  });

  it('coerces string env values', () => {
    const res = envSchemaWithRefines.safeParse({
      ...VALID,
      DATABASE_QUERY_TIMEOUT_MS: '40000',
      DATABASE_MAX_LIFETIME_S: '600',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.DATABASE_QUERY_TIMEOUT_MS).toBe(40_000);
      expect(res.data.DATABASE_MAX_LIFETIME_S).toBe(600);
    }
  });

  it('rejects query_timeout below statement_timeout when both are enabled', () => {
    const res = envSchemaWithRefines.safeParse({
      ...VALID,
      DATABASE_STATEMENT_TIMEOUT_MS: '30000',
      DATABASE_QUERY_TIMEOUT_MS: '20000',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('DATABASE_QUERY_TIMEOUT_MS'))).toBe(true);
    }
  });

  it('allows query_timeout below statement_timeout when either side is disabled (0)', () => {
    // statement_timeout=0 → operator opted out of the server cap; the client
    // timeout becoming the effective cap is their explicit choice.
    expect(
      envSchemaWithRefines.safeParse({
        ...VALID,
        DATABASE_STATEMENT_TIMEOUT_MS: '0',
        DATABASE_QUERY_TIMEOUT_MS: '20000',
      }).success,
    ).toBe(true);
    // query_timeout=0 → no client cap, server-side governs alone.
    expect(
      envSchemaWithRefines.safeParse({
        ...VALID,
        DATABASE_STATEMENT_TIMEOUT_MS: '30000',
        DATABASE_QUERY_TIMEOUT_MS: '0',
      }).success,
    ).toBe(true);
  });

  it('allows 0 (disable) but rejects negative', () => {
    expect(
      envSchemaWithRefines.safeParse({
        ...VALID,
        DATABASE_QUERY_TIMEOUT_MS: '0',
        DATABASE_MAX_LIFETIME_S: '0',
      }).success,
    ).toBe(true);
    expect(
      envSchemaWithRefines.safeParse({ ...VALID, DATABASE_QUERY_TIMEOUT_MS: '-1' }).success,
    ).toBe(false);
    expect(
      envSchemaWithRefines.safeParse({ ...VALID, DATABASE_MAX_LIFETIME_S: '-5' }).success,
    ).toBe(false);
  });
});
