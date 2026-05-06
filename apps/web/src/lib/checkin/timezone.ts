/**
 * Local-date helpers (J5).
 *
 * Daily check-ins anchor to the *member's* local calendar day, not UTC. We
 * use `Intl.DateTimeFormat` with a fixed `en-CA` locale to obtain a stable
 * `YYYY-MM-DD` representation regardless of host locale, and the user's IANA
 * timezone (default "Europe/Paris" — see User.timezone in the schema).
 *
 * Why en-CA: it's the only common locale whose default `toLocaleDateString`
 * format is exactly `YYYY-MM-DD` — no zero-padding gymnastics required.
 *
 * No external dependency: Node 22 LTS bundles full ICU so every IANA name
 * resolves. We treat unknown timezone strings as UTC (defensive).
 *
 * Reminder windows: SPEC §7.4 specifies 07:30 morning and 20:30 evening; we
 * accept a small grace window above (until 09:00 / 22:00) so the cron can
 * run every 15 minutes without missing anyone.
 */

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const MORNING_REMINDER_START_MIN = 7 * 60 + 30; // 07:30
const MORNING_REMINDER_END_MIN = 9 * 60; // 09:00
const EVENING_REMINDER_START_MIN = 20 * 60 + 30; // 20:30
const EVENING_REMINDER_END_MIN = 22 * 60; // 22:00

export type LocalDateString = string; // YYYY-MM-DD

/**
 * UTC instant → calendar day in the user's timezone, formatted YYYY-MM-DD.
 * Falls back to UTC if the timezone is unknown / malformed.
 */
export function localDateOf(instant: Date, timezone: string): LocalDateString {
  let tz = timezone;
  try {
    // Probe — Intl will throw a RangeError on an invalid tz.
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }

  // en-CA formatDateToParts returns year/month/day with zero padding.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` → `Date` at UTC midnight. Used to feed Prisma's `@db.Date`
 * column without timezone drift. Throws on malformed inputs (Zod-friendly).
 */
export function parseLocalDate(s: LocalDateString): Date {
  const m = DATE_REGEX.exec(s);
  if (!m) throw new Error(`Invalid local date string: ${s}`);
  const [, yearStr, monthStr, dayStr] = m;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  // Build via Date.UTC then verify the canonical roundtrip — Date.UTC silently
  // accepts e.g. month=13 (= Jan next year), so we re-format and compare.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${s}`);
  }
  return d;
}

/**
 * Shift a YYYY-MM-DD by N days (positive or negative). Pure string-in/out so
 * it composes with the streak walker.
 */
export function shiftLocalDate(s: LocalDateString, days: number): LocalDateString {
  if (days === 0) return s;
  const d = parseLocalDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Render a YYYY-MM-DD into a human-friendly French label, e.g.
 * "mardi 6 mai 2026". Used by the dashboard "Aujourd'hui" line.
 */
export function formatLocalDate(s: LocalDateString): string {
  const d = parseLocalDate(s);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/**
 * Extract the `HH:MM`-as-minutes-since-midnight in the user's timezone for a
 * given UTC instant. Used to gate reminder windows.
 */
function localMinutes(instant: Date, timezone: string): number {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-GB formats midnight as `00`, not `24` — safe to parse.
  return Number(hourStr) * 60 + Number(minuteStr);
}

export function isMorningReminderDue(instant: Date, timezone: string): boolean {
  const m = localMinutes(instant, timezone);
  return m >= MORNING_REMINDER_START_MIN && m < MORNING_REMINDER_END_MIN;
}

export function isEveningReminderDue(instant: Date, timezone: string): boolean {
  const m = localMinutes(instant, timezone);
  return m >= EVENING_REMINDER_START_MIN && m < EVENING_REMINDER_END_MIN;
}

export const REMINDER_WINDOWS = {
  morning: { startMin: MORNING_REMINDER_START_MIN, endMin: MORNING_REMINDER_END_MIN },
  evening: { startMin: EVENING_REMINDER_START_MIN, endMin: EVENING_REMINDER_END_MIN },
} as const;
