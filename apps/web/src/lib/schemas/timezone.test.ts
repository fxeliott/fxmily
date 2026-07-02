import { describe, expect, it } from 'vitest';

import { updateTimezoneInputSchema } from '@/lib/schemas/timezone';

/**
 * F2 — the member timezone write path. The schema validates against the exact
 * `SUPPORTED_TIMEZONES` allowlist (built from `Intl.supportedValuesOf`), so any
 * non-IANA / look-alike / oversized string a malicious client could POST is
 * rejected before it can silently degrade the member to the UTC fallback.
 */
describe('updateTimezoneInputSchema', () => {
  it('accepts a real IANA timezone from the catalogue', () => {
    expect(updateTimezoneInputSchema.safeParse({ timezone: 'Europe/Paris' }).success).toBe(true);
    expect(updateTimezoneInputSchema.safeParse({ timezone: 'America/New_York' }).success).toBe(
      true,
    );
    expect(updateTimezoneInputSchema.safeParse({ timezone: 'UTC' }).success).toBe(true);
  });

  it('rejects an unknown timezone with the `unknown_timezone` message', () => {
    const result = updateTimezoneInputSchema.safeParse({ timezone: 'Mars/Olympus' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('unknown_timezone');
    }
  });

  it('rejects an empty string', () => {
    expect(updateTimezoneInputSchema.safeParse({ timezone: '' }).success).toBe(false);
  });

  it('rejects an oversized payload (> 64 chars) before the set lookup', () => {
    expect(updateTimezoneInputSchema.safeParse({ timezone: 'A'.repeat(65) }).success).toBe(false);
  });

  it('rejects a missing timezone field', () => {
    expect(updateTimezoneInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown extra keys (strict object)', () => {
    expect(
      updateTimezoneInputSchema.safeParse({ timezone: 'Europe/Paris', role: 'admin' }).success,
    ).toBe(false);
  });
});
