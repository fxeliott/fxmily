import { CalendarRange } from 'lucide-react';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { CalendarOverview } from '@/components/calendar/calendar-overview';
import { CalendarWarnings } from '@/components/calendar/calendar-warnings';
import { CalendarWeekView } from '@/components/calendar/calendar-week-view';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { modelDisplay } from '@/lib/calendar/format';
import type { SerializedAdaptiveCalendar } from '@/lib/calendar/service';

/**
 * §26 Calendrier adaptatif — admin READ-ONLY calendar section (J-C4) for the
 * member detail `?tab=calendar`. Eliott reads the member's latest generated
 * calendar (the SAME overview / week-view / warnings the member sees, incl. the
 * EU AI Act banner) with **NO action / NO mutation** — the disclosure stamp is
 * the MEMBER's first-view concern only (the admin view never stamps it).
 *
 * Carbon `member-monthly-debriefs-panel`: same isolation posture (§2 — never a
 * real-edge surface; the calendar is read straight from `adaptive_calendars`,
 * never recomputed against `trades`). Shows the LATEST week (admin-only, not a
 * hot path, 30-member V1 scale).
 *
 * Empty state is honest "aucun calendrier" (canon §21.4/§23.4/§25.4) — never a
 * misleading "score 0".
 */

export function MemberCalendarPanel({ calendar }: { calendar: SerializedAdaptiveCalendar | null }) {
  if (calendar === null) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={CalendarRange}
          headline="Aucun calendrier généré pour ce membre."
          lead="Le calendrier de la semaine apparaîtra ici une fois que le membre aura rempli son questionnaire d'organisation et que Claude l'aura généré, un plan de temps, pas un score."
          headingLevel="h3"
        />
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-slot="member-calendar-panel">
      {/* The week range is shown once, by <CalendarOverview> below (shared with
          the member view) — no duplicate header subtitle (code-review T3-2). */}
      <h2 className="t-h2 text-[var(--t-1)]">Calendrier</h2>

      <AIGeneratedBanner variant="inline" modelName={modelDisplay(calendar.claudeModel)} />
      <CalendarOverview schedule={calendar.schedule} weekStart={calendar.weekStart} />
      <CalendarWeekView days={calendar.schedule.days} />
      <CalendarWarnings warnings={calendar.schedule.warnings} />
    </section>
  );
}
