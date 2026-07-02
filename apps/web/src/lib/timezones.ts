/**
 * IANA timezone catalogue + display helpers (F2 — per-member timezone).
 *
 * Pure module (no `server-only`, no DB, no env) so it is importable from both
 * the Server Component that builds the `<select>` options AND the Zod schema
 * that validates the write. The authoritative wall-clock <-> UTC conversions
 * live in `lib/checkin/timezone.ts`; THIS file only produces the catalogue and
 * the human-readable labels for the settings picker.
 *
 * Runtime note: Node 22 LTS ships full ICU and modern browsers expose
 * `Intl.supportedValuesOf('timeZone')` (~400+ zones). We probe for it
 * defensively and fall back to a curated cohort-relevant list if it is ever
 * absent, so the picker never renders empty.
 */

/**
 * Curated fallback used only if `Intl.supportedValuesOf` is unavailable
 * (never expected on Node 22 / modern browsers). Covers the cohort default
 * plus the most common member regions so a non-Paris member is never stranded.
 */
const FALLBACK_TIMEZONES: readonly string[] = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Berlin',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Moscow',
  // `Indian/Reunion` is the canonical IANA name for Réunion. (`Atlantic/Reunion`
  // is NOT a valid IANA zone — it throws in `Intl.DateTimeFormat` — so it never
  // belongs in the fallback the picker/write path trusts.)
  'Indian/Reunion',
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Abidjan',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Montreal',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Asia/Dubai',
  'Asia/Jerusalem',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

function loadSupportedTimezones(): readonly string[] {
  const intl = Intl as IntlWithSupportedValues;
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      const zones = intl.supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) {
        // Several ICU builds (incl. the one Node 22 ships with) omit ANY
        // universal zone from the canonical list — no `UTC`, no `Etc/UTC`. We
        // guarantee a bare `UTC` (a valid `Intl` timezone everywhere, and the
        // value the curated fallback also uses) so the picker always offers a
        // "Universel" option and a member's UTC choice validates + round-trips.
        return zones.includes('UTC') ? zones : [...zones, 'UTC'];
      }
    } catch {
      // fall through to the curated fallback
    }
  }
  return FALLBACK_TIMEZONES;
}

/**
 * Every IANA timezone the picker offers and the write path accepts. Computed
 * once at module load — the list is process-stable.
 */
export const SUPPORTED_TIMEZONES: readonly string[] = loadSupportedTimezones();

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_TIMEZONES);

/** True when `tz` is a timezone the picker/write path recognises. */
export function isSupportedTimezone(tz: string): boolean {
  return SUPPORTED_SET.has(tz);
}

/**
 * Signed UTC offset in minutes for `tz` at instant `at` (DST-correct, read at
 * the queried instant). Mirrors the private helper in `lib/checkin/timezone.ts`
 * but kept local since that one is not exported and this is display-only.
 * Returns 0 if the timezone is invalid (the caller still renders a label).
 */
function offsetMinutes(tz: string, at: Date): number {
  let zone = tz;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Format an offset (minutes) as `UTC+02:00` / `UTC-05:00` / `UTC±00:00`. */
export function formatUtcOffset(tz: string, at: Date): string {
  const total = offsetMinutes(tz, at);
  const sign = total > 0 ? '+' : total < 0 ? '-' : '±';
  const abs = Math.abs(total);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * Format an instant as a `datetime-local` input value (`YYYY-MM-DDTHH:mm`) in
 * the wall-clock of `tz`. F2 — used to pre-fill the trade entry/exit pickers at
 * "now" in the MEMBER's set timezone (not the device's), so the value the member
 * submits round-trips through the server conversion + display unchanged. Falls
 * back to UTC wall-clock if `tz` is invalid.
 */
export function formatDateTimeLocalInput(instant: Date, tz: string): string {
  let zone = tz;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    return found ? found.value : '';
  };
  // `Intl` may render midnight as hour 24 in some environments — normalise.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** The city/place portion of an IANA name, humanised (`America/New_York` -> `New York`). */
export function timezoneCityLabel(tz: string): string {
  const slash = tz.indexOf('/');
  const tail = slash === -1 ? tz : tz.slice(slash + 1);
  return tail.replace(/\//g, ' / ').replace(/_/g, ' ');
}

/** Full option label, e.g. `Paris (UTC+02:00)`. */
export function timezoneOptionLabel(tz: string, at: Date): string {
  return `${timezoneCityLabel(tz)} (${formatUtcOffset(tz, at)})`;
}

const REGION_LABELS_FR: Record<string, string> = {
  Africa: 'Afrique',
  America: 'Amérique',
  Antarctica: 'Antarctique',
  Arctic: 'Arctique',
  Asia: 'Asie',
  Atlantic: 'Atlantique',
  Australia: 'Australie',
  Europe: 'Europe',
  Indian: 'Océan Indien',
  Pacific: 'Pacifique',
  Etc: 'Universel',
  UTC: 'Universel',
};

export interface TimezoneOption {
  value: string;
  label: string;
}

export interface TimezoneOptionGroup {
  /** Region key (e.g. `Europe`) — stable id for React keys. */
  region: string;
  /** Localised region heading shown as the `<optgroup>` label. */
  label: string;
  options: TimezoneOption[];
}

/**
 * Build the grouped option list for the picker, sorted with Europe first
 * (cohort majority), then the other regions alphabetically (FR labels). Each
 * option carries the current UTC offset at `at` so a member can pick by offset.
 */
export function buildTimezoneOptionGroups(at: Date): TimezoneOptionGroup[] {
  const byRegion = new Map<string, TimezoneOption[]>();

  for (const tz of SUPPORTED_TIMEZONES) {
    const slash = tz.indexOf('/');
    const region = slash === -1 ? 'UTC' : tz.slice(0, slash);
    const options = byRegion.get(region) ?? [];
    options.push({ value: tz, label: timezoneOptionLabel(tz, at) });
    byRegion.set(region, options);
  }

  const groups: TimezoneOptionGroup[] = [];
  for (const [region, options] of byRegion) {
    options.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    groups.push({ region, label: REGION_LABELS_FR[region] ?? region, options });
  }

  const rank = (region: string): number => (region === 'Europe' ? 0 : 1);
  groups.sort((a, b) => {
    const byRank = rank(a.region) - rank(b.region);
    return byRank !== 0 ? byRank : a.label.localeCompare(b.label, 'fr');
  });

  return groups;
}
