/**
 * Tour 15 — pure decision logic for the dashboard timezone-mismatch nudge.
 *
 * Extracted from the client component so the "should we nudge?" rule and the
 * per-pair dismiss key are unit-testable without a DOM. The component owns the
 * effects (reading the browser zone, localStorage, rendering); this owns the
 * math (validity + comparison + storage key).
 */

const STORAGE_PREFIX = 'fxmily.tz-mismatch.dismissed';

/** True iff `tz` is a valid IANA name (Intl throws a RangeError otherwise). */
export function isValidIana(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff the two zones are both valid IANA names AND genuinely differ. A
 * nullish browser zone (not yet resolved on the client) is never a mismatch.
 */
export function isTimezoneMismatch(
  profileTimezone: string,
  browserTimezone: string | null,
): boolean {
  if (browserTimezone === null) return false;
  if (!isValidIana(profileTimezone) || !isValidIana(browserTimezone)) return false;
  return profileTimezone !== browserTimezone;
}

/**
 * localStorage dismiss key for a given ORDERED pair (profile > browser). Encodes
 * the pair so dismissing one situation never silences a later, different one.
 * Returns null when there is no mismatch (nothing to dismiss).
 */
export function dismissKeyFor(
  profileTimezone: string,
  browserTimezone: string | null,
): string | null {
  if (!isTimezoneMismatch(profileTimezone, browserTimezone)) return null;
  return `${STORAGE_PREFIX}.${profileTimezone}>${browserTimezone}`;
}
