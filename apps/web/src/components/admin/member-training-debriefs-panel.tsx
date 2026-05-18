import { NotebookPen } from 'lucide-react';

import { TrainingDebriefStatsPanel } from '@/components/training-debrief/training-debrief-stats-panel';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SerializedTrainingDebrief } from '@/lib/training-debrief/service';
import type { TrainingDebriefStats } from '@/lib/training-debrief/stats';

/**
 * V1.3 — admin READ-ONLY weekly-debrief section (SPEC §23.4) for the member
 * detail `?tab=training`. Lists the member's debriefs (full reflection text +
 * recomputed process stats) with NO action — annotation/notif on the debrief
 * is a separate later §21.6 follow-up (§23.6). Cyan DS-v2 reuse, same
 * isolation posture as `member-training-panel` (§21.5: never a real-edge
 * surface; the stats are recomputed §21.5-safe, never `resultR`/`outcome`).
 *
 * The page caps the list (≤12) and recomputes stats in parallel — admin-only,
 * not a hot path, 30-member V1 scale (same bound as the weekly-reports panel).
 */

const FMT_WEEK = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const FMT_SUBMITTED = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function weekRange(weekStart: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return FMT_WEEK.format(new Date(Date.UTC(y, m - 1, d)));
  };
  const [y, m, d] = weekStart.split('-').map(Number) as [number, number, number];
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmt(weekStart)} → ${fmt(end.toISOString().slice(0, 10))}`;
}

export interface MemberTrainingDebriefItem {
  debrief: SerializedTrainingDebrief;
  stats: TrainingDebriefStats;
}

export function MemberTrainingDebriefsPanel({
  items,
}: {
  items: readonly MemberTrainingDebriefItem[];
}) {
  if (items.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={NotebookPen}
          headline="Aucun débrief hebdo pour ce membre."
          lead="Les débriefs d'entraînement apparaîtront ici dès qu'il en aura écrit un."
          headingLevel="h3"
        />
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-slot="member-training-debriefs">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-h2 text-[var(--t-1)]">Débriefs hebdo</h2>
        <p className="t-cap text-[var(--t-3)]">
          {items.length} affiché{items.length > 1 ? 's' : ''}
        </p>
      </div>

      <ul className="flex flex-col gap-5">
        {items.map(({ debrief: d, stats }) => (
          <li key={d.id}>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <header className="flex items-baseline justify-between gap-3">
                <p className="t-eyebrow text-[var(--cy)]">Semaine du {weekRange(d.weekStart)}</p>
                <p className="t-cap font-mono text-[var(--t-3)]">
                  {FMT_SUBMITTED.format(new Date(d.submittedAt))}
                </p>
              </header>

              <TrainingDebriefStatsPanel stats={stats} />

              <dl className="flex flex-col gap-3">
                <DebriefField label="Force de process #1" value={d.processStrengthOne} />
                <DebriefField label="Force de process #2" value={d.processStrengthTwo} />
                <DebriefField label="Micro-ajustement" value={d.microAdjustment} />
                <DebriefField label="Leçon transversale" value={d.transversalLesson} />
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DebriefField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="t-eyebrow text-[var(--t-3)]">{label}</dt>
      <dd className="t-body whitespace-pre-wrap text-[var(--t-2)]">{value}</dd>
    </div>
  );
}
