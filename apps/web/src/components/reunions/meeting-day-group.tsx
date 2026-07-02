import { MeetingItem } from '@/components/reunions/meeting-item';
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

/** YYYY-MM-DD civil day key in Europe/Paris (en-CA gives the ISO ordering). */
const DAY_KEY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Human day header, e.g. « lundi 30 juin ». */
const DAY_LABEL_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
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
 * Group meetings by civil day (Europe/Paris), preserving the caller's day
 * ordering (the loader returns `scheduledAt desc`, so the first day seen is the
 * most recent → the output stays newest-day-first). Slots within a day are
 * re-sorted 12h → 20h so a day always reads chronologically regardless of the
 * input order.
 */
export function groupMeetingsByDay(meetings: MemberMeetingView[]): MeetingDay[] {
  const byDay = new Map<string, MemberMeetingView[]>();
  for (const m of meetings) {
    const key = DAY_KEY_FMT.format(new Date(m.scheduledAt));
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

export function MeetingDayGroup({ day }: { day: MeetingDay }) {
  // Midi UTC pour le libellé — évite le drift de jour à minuit (piège TZ canonique,
  // même garde que checkin-day-list).
  const label = DAY_LABEL_FMT.format(new Date(`${day.date}T12:00:00Z`));
  return (
    <section className="flex flex-col gap-2.5" aria-label={label}>
      <h3 className="t-eyebrow-lg text-[var(--t-3)] capitalize">{label}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {day.meetings.map((meeting) => (
          <MeetingItem key={meeting.id} meeting={meeting} showDate={false} />
        ))}
      </div>
    </section>
  );
}
