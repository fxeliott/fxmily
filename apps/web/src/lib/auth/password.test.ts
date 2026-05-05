import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('hashes a password to a non-empty argon2id PHC string', async () => {
    const hash = await hashPassword('a-strong-test-password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash.length).toBeGreaterThan(40);
  });

  it('produces a different hash for the same password (random salt)', async () => {
    const a = await hashPassword('same-password-xyz');
    const b = await hashPassword('same-password-xyz');
    expect(a).not.toBe(b);
  });

  it('verifies the correct password as true', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it('rejects a wrong password as false', async () => {
    const hash = await hashPassword('original-password');
    expect(await verifyPassword('different-password', hash)).toBe(false);
  });

  it('returns false (not throws) when given a malformed hash', async () => {
    expect(await verifyPassword('any', 'not-a-valid-phc-string')).toBe(false);
  });

  it('rejects an empty password against a real hash', async () => {
    const hash = await hashPassword('something');
    expect(await verifyPassword('', hash)).toBe(false);
  });
});
