import type { QualifyingRowView } from '@/lib/leaderboard/service';

import { Avatar } from '../ui/avatar';

/**
 * QualifyingSection — the public "En qualification" list (J3 SCOPE 1).
 *
 * Every active member who is checking in but has not reached the qualification
 * gate yet (`rank === null`) appears here with their PUBLIC "Xj/N" progression
 * and a calm progress bar, so the whole cohort sees itself climbing in from day
 * one. Unlike the ranked list, there is no score and no "pourquoi ce rang ?"
 * breakdown to reveal — a qualifying member has no rank yet — so each row is a
 * static, zero-client-JS line. The viewer's own row self-highlights (accent ring
 * + tint) so they find themselves instantly.
 *
 * Progression is behavioral only (days checked in), NEVER a trading result
 * (firewall §21.5). The "Xj/N" pair is a deliberate public signal (SPEC §16 does
 * NOT gate it, unlike the ranked day-count) — see {@link QualifyingRowView}.
 */

function QualifyingRow({ row }: { row: QualifyingRowView }): React.ReactElement {
  // Guard a zero denominator (the gate is always >= 1 via computeLeaderboardGate,
  // but stay defensive against a stale snapshot) and clamp the numerator so a
  // relaxed gate or a legacy snapshot (activeDays >= minActiveDays while still
  // rank null) never renders an invalid "5j/3" nor an aria-valuenow above
  // aria-valuemax.
  const safeMax = Math.max(1, row.minActiveDays);
  const shown = Math.max(0, Math.min(row.activeDays, safeMax));
  const pct = Math.round((shown / safeMax) * 100);

  return (
    <div
      className={`rounded-card flex items-center gap-3 border bg-[var(--bg-1)] px-3 py-2.5 sm:px-4 ${
        row.isViewer ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]' : 'border-[var(--b-default)]'
      }`}
    >
      <Avatar
        url={row.avatarUrl}
        initials={row.initials}
        firstName={row.firstName}
        size={40}
        ring={row.isViewer}
      />
      <span className="min-w-0 flex-1">
        {/* " (toi)" is a non-truncating sibling of the name so a long first name
            can never clip the self-marker; `title` gives the full name. */}
        <span className="flex items-baseline gap-1 text-[14px] font-medium text-[var(--t-1)]">
          <span className="min-w-0 truncate" title={row.firstName}>
            {row.firstName}
          </span>
          {row.isViewer ? <span className="shrink-0 text-[var(--t-3)]">(toi)</span> : null}
        </span>
        <span
          className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-3)]"
          role="progressbar"
          aria-valuenow={shown}
          aria-valuemin={0}
          aria-valuemax={safeMax}
          aria-label={`${shown} jours actifs sur ${safeMax} pour se qualifier`}
        >
          <span
            className="block h-full rounded-full bg-[var(--acc)]"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-0.5" aria-hidden="true">
        <span className="f-display text-[17px] font-bold text-[var(--t-1)] tabular-nums">
          {shown}
        </span>
        <span className="text-[13px] text-[var(--t-3)]">j/{safeMax}</span>
      </span>
    </div>
  );
}

export function QualifyingSection({ rows }: { rows: QualifyingRowView[] }): React.ReactElement {
  return (
    <section aria-label="En qualification">
      <h2 className="t-eyebrow mb-1 text-[var(--t-3)]">En qualification</h2>
      <p className="mb-3 text-[13px] leading-relaxed text-[var(--t-3)]">
        Encore quelques jours de check-ins pour entrer au classement.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.userId}>
            <QualifyingRow row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}
