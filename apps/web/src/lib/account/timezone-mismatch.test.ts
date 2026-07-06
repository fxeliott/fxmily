/**
 * Tour 15 — pure timezone-mismatch nudge logic.
 *
 * The nudge fires only when the browser zone and the profile zone are BOTH valid
 * IANA names and genuinely differ; the dismiss key encodes the ordered pair so a
 * dismissed situation never silences a later, different one.
 */

import { describe, expect, it } from 'vitest';

import { dismissKeyFor, isTimezoneMismatch, isValidIana } from './timezone-mismatch';

describe('isValidIana', () => {
  it('accepts valid IANA names', () => {
    expect(isValidIana('Europe/Paris')).toBe(true);
    expect(isValidIana('Asia/Tokyo')).toBe(true);
    expect(isValidIana('UTC')).toBe(true);
  });

  it('rejects nullish / malformed values', () => {
    expect(isValidIana(null)).toBe(false);
    expect(isValidIana(undefined)).toBe(false);
    expect(isValidIana('')).toBe(false);
    expect(isValidIana('Europe/Pariss')).toBe(false);
    expect(isValidIana('Not/AZone')).toBe(false);
  });
});

describe('isTimezoneMismatch', () => {
  it('is true when both zones are valid and differ', () => {
    expect(isTimezoneMismatch('Europe/Paris', 'Asia/Tokyo')).toBe(true);
  });

  it('is false when the zones are identical', () => {
    expect(isTimezoneMismatch('Europe/Paris', 'Europe/Paris')).toBe(false);
  });

  it('is false when the browser zone is not yet resolved (null)', () => {
    expect(isTimezoneMismatch('Europe/Paris', null)).toBe(false);
  });

  it('is false when either zone is not a valid IANA name', () => {
    expect(isTimezoneMismatch('Europe/Pariss', 'Asia/Tokyo')).toBe(false);
    expect(isTimezoneMismatch('Europe/Paris', 'Bogus/Zone')).toBe(false);
  });
});

describe('dismissKeyFor', () => {
  it('encodes the ordered profile>browser pair on a mismatch', () => {
    expect(dismissKeyFor('Europe/Paris', 'Asia/Tokyo')).toBe(
      'fxmily.tz-mismatch.dismissed.Europe/Paris>Asia/Tokyo',
    );
  });

  it('returns null when there is no mismatch', () => {
    expect(dismissKeyFor('Europe/Paris', 'Europe/Paris')).toBeNull();
    expect(dismissKeyFor('Europe/Paris', null)).toBeNull();
  });

  it('produces DIFFERENT keys for different pairs (re-surfaces on change)', () => {
    const first = dismissKeyFor('Europe/Paris', 'Asia/Tokyo');
    const second = dismissKeyFor('Europe/Paris', 'America/New_York');
    expect(first).not.toBe(second);
    // And the reverse ordering is a distinct key too.
    expect(dismissKeyFor('Asia/Tokyo', 'Europe/Paris')).not.toBe(first);
  });
});
