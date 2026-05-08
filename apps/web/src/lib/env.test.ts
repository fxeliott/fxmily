import { describe, expect, it } from 'vitest';

import { envSchemaWithRefines } from './env';

/**
 * J9 hardening E2 — cross-var consistency tests on VAPID env vars.
 *
 * The runtime `parsed = envSchemaWithRefines.safeParse(process.env)` lives
 * at module-import-time so we can't assert against it directly. Instead we
 * test the schema in isolation with synthetic env objects.
 */

const BASE_VALID_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  AUTH_SECRET: 'test_secret_at_least_32_characters_long_for_dev_xy',
  AUTH_URL: 'http://localhost:3000',
} as const;

// 87-char base64url VAPID public key (canonical P-256 ECDSA).
const VALID_VAPID_PUB = 'BNc' + 'A'.repeat(84);
// 43-char base64url VAPID private key (canonical 32-byte scalar).
const VALID_VAPID_PRIV = 'tA9' + 'B'.repeat(40);

describe('envSchemaWithRefines — VAPID cross-var refines (J9 E2)', () => {
  it('accepts the env when all VAPID vars are absent (V1 default)', () => {
    const r = envSchemaWithRefines.safeParse(BASE_VALID_ENV);
    expect(r.success).toBe(true);
  });

  it('accepts the env when all 3 VAPID vars are present + matching pubkey mirror', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:eliott.pena@icloud.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('rejects when only VAPID_PUBLIC_KEY is set (private missing)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('VAPID_PRIVATE_KEY');
    }
  });

  it('rejects when only VAPID_PRIVATE_KEY is set (public missing)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
    });
    expect(r.success).toBe(false);
  });

  it('rejects when VAPID_PUBLIC_KEY is set but NEXT_PUBLIC mirror is missing', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:test@example.com',
      // NEXT_PUBLIC_VAPID_PUBLIC_KEY missing
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    }
  });

  it('rejects when NEXT_PUBLIC mirror has a different value than the server pubkey (drift)', () => {
    const otherPub = 'BNc' + 'C'.repeat(84);
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:test@example.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: otherPub,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('mirror');
    }
  });

  it('accepts VAPID_SUBJECT with mailto: prefix', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:foo@bar.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('accepts VAPID_SUBJECT with https:// prefix', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'https://app.fxmily.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('rejects VAPID_SUBJECT with bare email (no scheme)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_SUBJECT: 'eliott@fxmily.com',
    });
    expect(r.success).toBe(false);
  });
});
