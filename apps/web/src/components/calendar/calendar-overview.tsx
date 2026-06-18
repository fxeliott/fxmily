import { formatWeekRangeFr } from '@/lib/calendar/week';
import type { AdaptiveCalendarOutput } from '@/lib/schemas/adaptive-calendar';

/**
 * §26 Calendrier adaptatif — week header + overview text + weekly focus (J-C4).
 *
 * Pure Server Component (carbone the `monthly-debrief-reader` section pattern:
 * eyebrow `<p>` labels, never headings — the page/panel owns the heading
 * hierarchy). DS-v2 NEUTRAL/lime — never `--cy*` (training) nor `.v18-*`
 * (REFLECT).
 *
 * `weeklyFocus` carries a Mark Douglas psychological principle (process >
 * outcome) — NEVER a market view (§2). It gets the lime accent treatment to
 * mark it as the week's anchor thought, calmly.
 */
export function CalendarOverview({
  schedule,
  weekStart,
}: {
  schedule: AdaptiveCalendarOutput;
  weekStart: string;
}) {
  const range = formatWeekRangeFr(weekStart);

  return (
    <div className="flex flex-col gap-4" data-slot="calendar-overview">
      <section className="rounded-card-lg border border-[var(--b-default)] p-5">
        <p className="t-eyebrow-lg text-[var(--t-3)]">Semaine du {range}</p>
        <p className="t-body mt-2 leading-[1.65] whitespace-pre-line text-[var(--t-1)]">
          {schedule.overview}
        </p>
      </section>

      <section className="rounded-card-lg border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5">
        <p className="t-eyebrow-lg text-[var(--acc-hi)]">Focus de la semaine</p>
        <p className="t-body mt-2 leading-[1.65] whitespace-pre-line text-[var(--t-1)]">
          {schedule.weeklyFocus}
        </p>
      </section>
    </div>
  );
}
