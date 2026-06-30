import { CalendarDays, Layers, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SeanceStats } from '@/lib/seances/service';

/**
 * Hub stat strip (Server Component) — séances publiées / journées couvertes /
 * actifs suivis. Honest counts derived from `done` sessions only (a cancelled
 * slot is never counted as a published séance). DS-v3 neutral surface, AA.
 */
const STATS: { key: keyof SeanceStats; label: string; Icon: LucideIcon }[] = [
  { key: 'sessions', label: 'séances publiées', Icon: Video },
  { key: 'days', label: 'journées couvertes', Icon: CalendarDays },
  { key: 'assets', label: 'actifs suivis', Icon: Layers },
];

export function SeancesStatGrid({ stats }: { stats: SeanceStats }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {STATS.map(({ key, label, Icon }) => (
        <div
          key={key}
          className="rounded-card flex flex-col gap-1 border border-[var(--b-default)] bg-[var(--bg-1)] p-3 sm:p-4"
        >
          <Icon className="h-4 w-4 text-[var(--acc)]" strokeWidth={1.75} aria-hidden="true" />
          <dd className="f-display text-[26px] leading-none font-bold text-[var(--t-1)] tabular-nums sm:text-[30px]">
            {stats[key]}
          </dd>
          <dt className="t-cap text-[var(--t-3)]">{label}</dt>
        </div>
      ))}
    </dl>
  );
}
