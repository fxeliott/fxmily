import { ChevronDown } from 'lucide-react';

import type { LeaderboardRowView } from '@/lib/leaderboard/service';

import { Avatar } from '../ui/avatar';
import { RankBreakdown } from './rank-breakdown';

/**
 * LeaderboardList — the ranked members below the podium (rank 4+).
 *
 * Each member is a native `<details>` disclosure: the `<summary>` is the row
 * (rank, face, first name, score); expanding it reveals the same "pourquoi ce
 * rang ?" pillar breakdown as the member's own card. Native disclosure keeps it
 * fully keyboard-accessible and reduced-motion-safe with zero client JS. The
 * viewer's own row self-highlights (accent ring + tint) so they find themselves
 * instantly in a long list.
 */

function LeaderboardRow({ row }: { row: LeaderboardRowView }): React.ReactElement {
  return (
    <details
      className={`group rounded-card border bg-[var(--bg-1)] transition-colors ${
        row.isViewer
          ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]'
          : 'border-[var(--b-default)] hover:border-[var(--b-strong)]'
      }`}
    >
      <summary className="rounded-card flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="f-mono w-7 shrink-0 text-center text-[15px] font-semibold text-[var(--t-2)] tabular-nums">
          {row.rank}
        </span>
        <Avatar
          url={row.avatarUrl}
          initials={row.initials}
          firstName={row.firstName}
          size={40}
          ring={row.isViewer}
        />
        <span className="min-w-0 flex-1">
          {/* " (toi)" is a non-truncating sibling of the name so a long first
              name can never clip the self-marker; `title` gives the full name. */}
          <span className="flex items-baseline gap-1 text-[14px] font-medium text-[var(--t-1)]">
            <span className="min-w-0 truncate" title={row.firstName ?? undefined}>
              {row.firstName}
            </span>
            {row.isViewer ? <span className="shrink-0 text-[var(--t-3)]">(toi)</span> : null}
          </span>
          <span className="t-eyebrow text-[var(--t-4)]">Voir le détail</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="f-display text-[17px] font-bold text-[var(--t-1)] tabular-nums">
            {row.score ?? 0}
          </span>
          <span className="text-[11px] text-[var(--t-3)]">/100</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[var(--t-3)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          strokeWidth={2}
        />
      </summary>
      <div className="border-t border-[var(--b-subtle)] px-3 pt-3 pb-4 sm:px-4">
        <RankBreakdown breakdown={row.breakdown} />
      </div>
    </details>
  );
}

export function LeaderboardList({ rows }: { rows: LeaderboardRowView[] }): React.ReactElement {
  return (
    <section aria-label="Classement complet">
      <h2 className="t-eyebrow mb-3 text-[var(--t-3)]">Le reste du classement</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.userId}>
            <LeaderboardRow row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}
