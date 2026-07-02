/**
 * F2 — member-timezone display of a meeting's wall-clock time.
 *
 * Meetings are COHORT events anchored to Europe/Paris (12h/20h, cron-generated),
 * but each member reads their OWN wall-clock (SPEC F2: the whole app follows the
 * member's set timezone). A Paris 12h meeting therefore renders as « 6h » for a
 * New York member and « 15h30 » for a Kolkata one (half-hour offsets are real).
 *
 * Formatters are cached per timezone: Intl.DateTimeFormat construction is
 * expensive and the /reunions list renders one row per meeting (same canon as
 * the module-hoisted formatters this replaces).
 */

const HOUR_MINUTE_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function hourMinuteFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = HOUR_MINUTE_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('fr-FR', {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    });
    HOUR_MINUTE_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * « 12h », « 6h », « 15h30 » — the meeting instant in the member's timezone,
 * French compact style (minutes only when non-zero).
 */
export function formatMeetingSlotTime(scheduledAt: Date | string, timeZone: string): string {
  const instant = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  const parts = hourMinuteFormatter(timeZone).formatToParts(instant);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const h = String(Number(hour));
  return minute === '00' ? `${h}h` : `${h}h${minute}`;
}
