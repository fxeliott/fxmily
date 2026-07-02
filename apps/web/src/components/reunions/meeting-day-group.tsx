import { MeetingItem } from '@/components/reunions/meeting-item';
import { Pill } from '@/components/ui/pill';
import type { MemberMeetingView } from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';

/**
 * F4 — « vue à la journée » for `/reunions`.
 *
 * The member brief asked to see meetings grouped BY DAY (its 12h + 20h slots
 * together) instead of a flat newest-first grid where the two slots of one day
 * drift apart. This groups the already-loaded {@link MemberMeetingView}s by their
 * civil day (Europe/Paris — the V1 cohort is France, SPEC §16) and renders one
 * calm day header per day, with the day's slots ordered chronologically
 * (12h then 20h).
 *
 * Pure grouping ({@link groupMeetingsByDay}) is split out so it unit-tests in
 * isolation (day boundary at the Paris midnight, slot order, day order) with no
 * DOM. Posture is inherited from {@link MeetingItem} — neutral, never red §30.7.
 */

// F2 — formatters cached per member timezone (Intl construction is expensive;
// same canon as the module-hoisted formatters this replaces, extended to
// arbitrary member zones).
const DAY_KEY_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD civil day key in the member's timezone (en-CA = ISO ordering). */
function dayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = DAY_KEY_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    DAY_KEY_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Civil day key (YYYY-MM-DD) of an instant in the member's timezone — the same
 * key {@link groupMeetingsByDay} buckets by. The page derives "today" with it
 * at render time so {@link MeetingDayGroup} stays clock-free (testable).
 */
export function civilDayKey(instant: Date | string, timezone: string): string {
  return dayKeyFormatter(timezone).format(new Date(instant));
}

/** Human day header, e.g. « lundi 30 juin ». The civil day is ALREADY resolved
 *  by the member-tz day key, so the label formats the midi-UTC instant in UTC
 *  (canonical anti-drift guard — same as checkin-day-list). */
const DAY_LABEL_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** Chronological slot order WITHIN a day (12h before 20h). */
const SLOT_ORDER: Record<MeetingSlotName, number> = { midday: 0, evening: 1 };

export interface MeetingDay {
  /** Civil day key, YYYY-MM-DD (Europe/Paris). */
  date: string;
  /** The day's meetings, ordered 12h then 20h. */
  meetings: MemberMeetingView[];
}

/**
 * Group meetings by civil day in the MEMBER's timezone (F2 — the whole app
 * reads in the member's wall-clock; a Paris 20h meeting belongs to the same
 * civil day at 14h for a New York member, but a Paris 00:30 one shifts a day),
 * preserving the caller's day ordering (the loader returns `scheduledAt desc`,
 * so the first day seen is the most recent → the output stays
 * newest-day-first). Slots within a day are re-sorted 12h → 20h so a day
 * always reads chronologically regardless of the input order.
 */
export function groupMeetingsByDay(meetings: MemberMeetingView[], timezone: string): MeetingDay[] {
  const dayKeyFmt = dayKeyFormatter(timezone);
  const byDay = new Map<string, MemberMeetingView[]>();
  for (const m of meetings) {
    const key = dayKeyFmt.format(new Date(m.scheduledAt));
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = [];
      byDay.set(key, bucket);
    }
    bucket.push(m);
  }
  return Array.from(byDay.entries()).map(([date, ms]) => ({
    date,
    meetings: ms.slice().sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]),
  }));
}

export function MeetingDayGroup({
  day,
  timezone,
  isToday = false,
}: {
  day: MeetingDay;
  timezone: string;
  /** F4 — highlight the member's current civil day (derived by the page via {@link civilDayKey}). */
  isToday?: boolean;
}) {
  // Midi UTC pour le libellé — le jour civil est déjà résolu par la clé
  // membre-tz, formater l'instant midi-UTC en UTC évite tout drift de jour
  // (piège TZ canonique, même garde que checkin-day-list).
  const label = DAY_LABEL_FMT.format(new Date(`${day.date}T12:00:00Z`));
  return (
    <section
      className="flex flex-col gap-2.5"
      aria-label={isToday ? `${label} (aujourd’hui)` : label}
    >
      <div className="flex items-center gap-2">
        <h3 className="t-eyebrow-lg text-[var(--t-3)] capitalize">{label}</h3>
        {isToday && <Pill tone="acc">Aujourd’hui</Pill>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {day.meetings.map((meeting) => (
          <MeetingItem key={meeting.id} meeting={meeting} timezone={timezone} showDate={false} />
        ))}
      </div>
    </section>
  );
}
