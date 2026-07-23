import { safeTimeZone } from './timezone';

/**
 * Dynamic check-in CTA (SCOPE 4).
 *
 * The member-facing guide used to hardcode `/checkin/morning` links. This pure
 * helper computes the slot that fits the current moment in the member's own
 * timezone, so the CTA points to the relevant slot (matin avant 14h, soir après).
 *
 * The rule is EXACTLY the one in `app/checkin/page.tsx` (`currentHourIn`): the
 * local hour via `Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false })`,
 * then `< 14 => morning, else evening`. Keeping both in lockstep guarantees the
 * guide CTA and the /checkin landing surface the same slot at the same moment.
 *
 * The timezone flows through {@link safeTimeZone} — a non-IANA legacy value
 * (e.g. "Europe/Pariss") would make `Intl` throw a `RangeError`, so it is fenced
 * to the app default `Europe/Paris` instead of taking the caller down.
 */
export interface CheckinCtaResult {
  slot: 'morning' | 'evening';
  href: '/checkin/morning' | '/checkin/evening';
  label: string;
}

const CTA_LABEL = {
  morning: 'Faire mon check-in du matin',
  evening: 'Faire mon check-in du soir',
} as const;

/**
 * Local hour (0–23) in the member's timezone for a given instant. Byte-faithful
 * copy of `currentHourIn` in `app/checkin/page.tsx` so the slot rule never drifts.
 */
function currentHourIn(timezone: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
}

export function checkinCta(now: Date, timezone: string): CheckinCtaResult {
  const tz = safeTimeZone(timezone);
  const slot: 'morning' | 'evening' = currentHourIn(tz, now) < 14 ? 'morning' : 'evening';
  return {
    slot,
    href: slot === 'morning' ? '/checkin/morning' : '/checkin/evening',
    label: CTA_LABEL[slot],
  };
}
