import { describe, expect, it } from 'vitest';

import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
  safeCompareHex,
} from './invitations';

describe('generateInvitationToken', () => {
  it('produces a 32-character token from the URL-safe alphabet', () => {
    const token = generateInvitationToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produces unique tokens across many calls', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) tokens.add(generateInvitationToken());
    expect(tokens.size).toBe(200);
  });
});

describe('hashInvitationToken', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', () => {
    const hash = hashInvitationToken('any-input');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashInvitationToken('alpha')).toBe(hashInvitationToken('alpha'));
  });

  it('is sensitive to single-character changes (avalanche)', () => {
    const a = hashInvitationToken('alpha');
    const b = hashInvitationToken('alphb');
    expect(a).not.toBe(b);
  });
});

describe('safeCompareHex', () => {
  it('returns true for identical strings', () => {
    expect(safeCompareHex('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeCompareHex('abc123', 'abc124')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(safeCompareHex('abc', 'abcd')).toBe(false);
  });
});

describe('INVITATION_TTL_MS', () => {
  it('is exactly 7 days', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
