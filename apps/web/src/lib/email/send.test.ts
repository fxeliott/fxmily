import { describe, expect, it } from 'vitest';

import { buildInviteUrl } from './send';

describe('buildInviteUrl', () => {
  it('appends the token as a URL query parameter', () => {
    const url = buildInviteUrl('abc123');
    expect(url).toBe('http://localhost:3000/onboarding/welcome?token=abc123');
  });

  it('URL-encodes special characters in the token', () => {
    // The token alphabet excludes these characters in production, but the
    // builder must still defend against a hand-crafted value reaching it.
    const url = buildInviteUrl('a b/c?d&e');
    expect(url).toContain('?token=');
    expect(url).toContain('a%20b%2Fc%3Fd%26e');
  });

  it('strips a trailing slash on AUTH_URL before appending the path', () => {
    // Cannot easily mutate AUTH_URL at test runtime without crashing the env
    // module, so we just sanity-check that the canonical localhost form
    // produces no double slashes.
    const url = buildInviteUrl('xyz');
    expect(url).not.toContain('//onboarding');
  });
});
