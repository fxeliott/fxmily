import { CalendarRange } from 'lucide-react';

import { MonthlyDebriefReader } from '@/components/monthly-debrief/monthly-debrief-reader';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMonthLabelFr } from '@/lib/monthly-debrief/format';
import type { SerializedMonthlyDebrief } from '@/lib/monthly-debrief/types';

/**
 * V1.4 — admin READ-ONLY monthly-debrief section (SPEC §25.4/§25.6) for the
 * member detail `?tab=monthly-debrief`. Eliott reads the member's persisted
 * AI syntheses (the SAME `<MonthlyDebriefReader>` the member sees, incl. the
 * EU AI Act banner) with **NO action** — annotation/notif on the monthly
 * debrief is a deferred §21.6 follow-up (§25.6, mirror §23.6).
 *
 * Carbon `member-training-debriefs-panel`: same isolation posture (§21.5 —
 * never a real-edge surface; the debrief is read straight from
 * `monthly_debriefs`, never recomputed against `trades`). The page caps the
 * list at 24 (admin-only, not a hot path, 30-member V1 scale).
 *
 * Empty state is honest "mois calme" (canon §21.4/§23.4/§25.4) — never a
 * misleading "score 0".
 */

const FMT_GENERATED = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function MemberMonthlyDebriefsPanel({
  debriefs,
}: {
  debriefs: readonly SerializedMonthlyDebrief[];
}) {
  if (debriefs.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={CalendarRange}
          headline="Aucun débrief mensuel pour ce membre."
          lead="La synthèse mensuelle apparaîtra ici au début du mois suivant, un recul sur le mois, pas un score."
          headingLevel="h3"
        />
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-slot="member-monthly-debriefs">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-h2 text-[var(--t-1)]">Débriefs mensuels</h2>
        <p className="t-cap text-[var(--t-3)]">
          {debriefs.length} affiché{debriefs.length > 1 ? 's' : ''}
        </p>
      </div>

      <ul className="flex flex-col gap-5">
        {debriefs.map((d) => (
          <li key={d.id}>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <header className="flex items-baseline justify-between gap-3">
                <h3 className="t-h3 text-[var(--t-1)]">{formatMonthLabelFr(d.monthStart)}</h3>
                <p className="t-cap font-mono text-[var(--t-3)]">
                  Généré le {FMT_GENERATED.format(new Date(d.generatedAt))}
                </p>
              </header>
              <MonthlyDebriefReader debrief={d} />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
