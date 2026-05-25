import { describe, expect, it } from 'vitest';

import { hashUserId } from './user-scrub';

/**
 * Session W Voie A2 — TDD tests for SHA-256 user-id pseudonymizer wired into
 * Sentry `beforeSend`. Pure functions, isomorphic Web Crypto API.
 *
 * Coverage:
 *  - deterministic : same input → same output (Sentry "events grouped by user" preserved)
 *  - format pin    : exactly 16 chars hex /^[0-9a-f]{16}$/
 *  - collision     : different inputs → different outputs (no truncation collision V1 cohort)
 *  - guards        : empty / null / undefined / whitespace → null (Sentry-safe)
 *  - NFC normalize : ASCII pass-through identity (cuid V1 alphanum-only)
 */

describe('hashUserId', () => {
  it('is deterministic — same input returns the same hash twice', async () => {
    const a = await hashUserId('clx0test123member');
    const b = await hashUserId('clx0test123member');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('returns exactly 16 hex chars (64-bit space, ~77k member collision threshold V2)', async () => {
    const h = await hashUserId('clx0test123member');
    expect(h).not.toBeNull();
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toHaveLength(16);
  });

  it('different inputs produce different hashes (no truncation collision V1 cohort)', async () => {
    const a = await hashUserId('clx0test123aaa');
    const b = await hashUserId('clx0test123bbb');
    const c = await hashUserId('clx0test123ccc');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('returns null on empty string (Sentry-safe guard)', async () => {
    expect(await hashUserId('')).toBeNull();
  });

  it('returns null on whitespace-only string', async () => {
    expect(await hashUserId('   ')).toBeNull();
    expect(await hashUserId('\t\n')).toBeNull();
  });

  it('returns null on null / undefined (defensive Sentry beforeSend)', async () => {
    expect(await hashUserId(null)).toBeNull();
    expect(await hashUserId(undefined)).toBeNull();
  });

  it('NFC normalises before hashing — ASCII input passes through identically', async () => {
    // ASCII cuid V1 is NFC-stable; pre-normalising shouldn't change the hash.
    const ascii = await hashUserId('clx0test123ascii');
    const normalised = await hashUserId('clx0test123ascii'.normalize('NFC'));
    expect(ascii).toBe(normalised);
  });

  it('NFC normalises composed vs decomposed Unicode to the same hash', async () => {
    // NFC: 'é' = single codepoint U+00E9 (composed)
    // NFD: 'é' = 'e' + COMBINING ACUTE ACCENT U+0301 (decomposed)
    // Both should hash identically after NFC normalisation.
    const composed = await hashUserId('user-é');
    const decomposed = await hashUserId('user-é');
    expect(composed).not.toBeNull();
    expect(composed).toBe(decomposed);
  });
});
