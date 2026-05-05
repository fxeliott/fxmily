import type { TradeSession } from '@/generated/prisma/enums';

/**
 * Trading session helpers (J2, SPEC §6.2 + §7.3).
 *
 * Behaviour:
 *   - Sessions are derived from the entry timestamp's UTC hour. We resolve to
 *     UTC via the platform's `Date#getUTCHours()` (no library needed; Date
 *     internally handles DST when constructed from an ISO string with offset).
 *   - The user can override the auto-suggestion in the wizard (e.g. they want
 *     to bucket their trade as "London" even though the clock is in overlap);
 *     that override is what we persist. The auto-detected value is just the
 *     default selection.
 *   - Bands chosen to give a sensible default in standard (winter) time. They
 *     remain serviceable in DST: the boundaries shift by one hour but the
 *     classification stays useful for journal-level analytics. If finer
 *     accuracy becomes a need, switch to a `@js-joda/core` zoned-datetime
 *     mapping.
 *
 * Bands (UTC):
 *   00:00–07:00 → asia
 *   07:00–12:00 → london
 *   12:00–16:00 → overlap (London/NY)
 *   16:00–21:00 → newyork
 *   21:00–24:00 → asia (Tokyo open, late evening Europe)
 */

/**
 * Derive the most likely trading session from a UTC instant.
 *
 * Accepts a `Date` object OR an ISO 8601 string. If given a string without
 * timezone info we treat it as UTC (consistent with form inputs that emit
 * `YYYY-MM-DDTHH:mm` and rely on the user's local timezone elsewhere — the
 * caller is expected to convert to UTC before invoking this helper).
 */
export function detectSession(at: Date | string): TradeSession {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) {
    // Defensive: if the input is unparseable, default to overlap (the most
    // common session for retail traders trading EU/US hours).
    return 'overlap';
  }

  const utcHour = date.getUTCHours();

  if (utcHour < 7) return 'asia';
  if (utcHour < 12) return 'london';
  if (utcHour < 16) return 'overlap';
  if (utcHour < 21) return 'newyork';
  return 'asia';
}

/**
 * Human label for the radio cards in the wizard.
 */
export const SESSION_LABEL: Record<TradeSession, string> = {
  asia: 'Asie (Tokyo)',
  london: 'Londres',
  overlap: 'Overlap (Londres/NY)',
  newyork: 'New York',
};

/**
 * Short hint shown beneath each session card. Helps members make a confident
 * override when the auto-detection is wrong (e.g. they entered late in the
 * London session but counted the position as a NY trade).
 */
export const SESSION_HINT: Record<TradeSession, string> = {
  asia: '00:00 – 07:00 UTC',
  london: '07:00 – 12:00 UTC',
  overlap: '12:00 – 16:00 UTC',
  newyork: '16:00 – 21:00 UTC',
};

export const SESSIONS: readonly TradeSession[] = ['asia', 'london', 'overlap', 'newyork'] as const;
