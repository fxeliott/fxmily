import { describe, expect, it } from 'vitest';

import { hashIp } from './audit';

describe('hashIp', () => {
  it('returns a 64-character lowercase hex string (SHA-256 of salted input)', () => {
    const hash = hashIp('203.0.113.42');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashIp('203.0.113.42')).toBe(hashIp('203.0.113.42'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashIp('203.0.113.42')).not.toBe(hashIp('203.0.113.43'));
  });

  it('produces different hashes for IPv4 vs IPv6 same address text', () => {
    expect(hashIp('::1')).not.toBe(hashIp('127.0.0.1'));
  });

  it('produces different hashes than a raw SHA-256 of the IP (the salt matters)', async () => {
    const { createHash } = await import('node:crypto');
    const rawSha = createHash('sha256').update('203.0.113.42', 'utf8').digest('hex');
    const salted = hashIp('203.0.113.42');
    expect(salted).not.toBe(rawSha);
  });
});
