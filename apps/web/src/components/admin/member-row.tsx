import Link from 'next/link';

import type { MemberSummary } from '@/lib/admin/members-service';

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

interface MemberRowProps {
  member: MemberSummary;
}

/**
 * Single row in the admin members list (J3, SPEC §7.7).
 *
 * Mobile-first: rendered as a clickable card that expands to a multi-cell
 * row on `sm:`. Targets the same minimum touch dimensions as the journal
 * trade card (44px) so the admin UI stays consistent on iPhone SE.
 */
export function MemberRow({ member }: MemberRowProps) {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName.length > 0 ? fullName : member.email;
  const isAdmin = member.role === 'admin';
  const isSuspended = member.status === 'suspended';

  return (
    <Link
      href={`/admin/members/${member.id}`}
      className="bg-card hover:border-accent focus-visible:outline-accent group flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:flex-row sm:items-center sm:justify-between"
      aria-label={`Voir le profil de ${displayName}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate text-base font-semibold">{displayName}</span>
          {isAdmin ? (
            <span className="border-accent/40 text-accent inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Admin
            </span>
          ) : null}
          {isSuspended ? (
            <span className="border-warning/40 text-warning inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Suspendu
            </span>
          ) : null}
        </div>
        <span className="text-muted truncate text-xs">{member.email}</span>
      </div>

      <dl className="grid grid-cols-3 gap-x-4 text-xs sm:gap-x-6">
        <div className="flex flex-col items-start sm:items-end">
          <dt className="text-muted">Trades</dt>
          <dd className="text-foreground font-mono tabular-nums">{member.tradesCount}</dd>
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <dt className="text-muted">Ouverts</dt>
          <dd
            className={[
              'font-mono tabular-nums',
              member.tradesOpenCount > 0 ? 'text-warning' : 'text-muted',
            ].join(' ')}
          >
            {member.tradesOpenCount}
          </dd>
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <dt className="text-muted">Inscrit</dt>
          <dd className="text-muted text-[11px]">
            {DATETIME_FMT.format(new Date(member.joinedAt))}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
