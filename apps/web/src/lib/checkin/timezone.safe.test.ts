import { describe, expect, it } from 'vitest';

import { safeTimeZone } from './timezone';

/**
 * `safeTimeZone` fences a member `User.timezone` before it reaches a display
 * `Intl.DateTimeFormat`. A non-IANA legacy value (e.g. "Europe/Pariss") makes
 * `Intl` throw a `RangeError` on construction — this helper must swallow that
 * and return the app default so a formatter never takes a page down.
 */
describe('safeTimeZone', () => {
  it('returns a valid IANA timezone unchanged', () => {
    expect(safeTimeZone('Europe/Paris')).toBe('Europe/Paris');
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
    expect(safeTimeZone('UTC')).toBe('UTC');
    expect(safeTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('falls back to Europe/Paris on a malformed / non-IANA value', () => {
    expect(safeTimeZone('Europe/Pariss')).toBe('Europe/Paris');
    expect(safeTimeZone('Mars/Olympus')).toBe('Europe/Paris');
    expect(safeTimeZone('not-a-timezone')).toBe('Europe/Paris');
  });

  it('falls back to Europe/Paris on empty, null or undefined', () => {
    expect(safeTimeZone('')).toBe('Europe/Paris');
    expect(safeTimeZone(null)).toBe('Europe/Paris');
    expect(safeTimeZone(undefined)).toBe('Europe/Paris');
  });

  it('produces a tz that never throws when fed to Intl.DateTimeFormat', () => {
    for (const input of ['Europe/Pariss', '', null, undefined, 'garbage']) {
      const tz = safeTimeZone(input);
      expect(() => new Intl.DateTimeFormat('fr-FR', { timeZone: tz })).not.toThrow();
    }
  });
});
