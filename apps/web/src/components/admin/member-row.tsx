import { Shield, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
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
 *
 * DS-v3 (S9 MAJ-40 reskin): consumes semantic tokens (bg-1, b-default, t-1..3),
 * `rounded-card`, the shared `Pill` for the Admin/Suspended badges and the
 * `HoverLift` spring (calm scale 1.02 + 2px lift, reduced-motion-safe) so the
 * admin list gets the same "mouvement au survol" premium as the member-facing
 * cards — instead of the prior raw shadcn aliases (`bg-card`/`text-muted`).
 */
export function MemberRow({ member }: MemberRowProps) {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName.length > 0 ? fullName : member.email;
  const isAdmin = member.role === 'admin';
  const isSuspended = member.status === 'suspended';

  return (
    <HoverLift className="block h-full">
      <Link
        href={`/admin/members/${member.id}`}
        className="rounded-card flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 shadow-[var(--sh-card)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)] sm:flex-row sm:items-center sm:justify-between"
        aria-label={`Voir le profil de ${displayName}`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-h3 truncate text-[var(--t-1)]">{displayName}</span>
            {isAdmin ? (
              <Pill tone="acc">
                <Shield aria-hidden="true" className="h-2.5 w-2.5" />
                Admin
              </Pill>
            ) : null}
            {isSuspended ? (
              <Pill tone="warn">
                <ShieldAlert aria-hidden="true" className="h-2.5 w-2.5" />
                Suspendu
              </Pill>
            ) : null}
          </div>
          <span className="t-cap truncate text-[var(--t-3)]">{member.email}</span>
        </div>

        <dl className="grid grid-cols-3 gap-x-4 text-xs sm:gap-x-6">
          <div className="flex flex-col items-start sm:items-end">
            <dt className="t-eyebrow text-[var(--t-3)]">Trades</dt>
            <dd className="f-mono text-[var(--t-1)] tabular-nums">{member.tradesCount}</dd>
          </div>
          <div className="flex flex-col items-start sm:items-end">
            <dt className="t-eyebrow text-[var(--t-3)]">Ouverts</dt>
            <dd
              className={[
                'f-mono tabular-nums',
                member.tradesOpenCount > 0 ? 'text-[var(--warn)]' : 'text-[var(--t-3)]',
              ].join(' ')}
            >
              {member.tradesOpenCount}
            </dd>
          </div>
          <div className="flex flex-col items-start sm:items-end">
            <dt className="t-eyebrow text-[var(--t-3)]">Inscrit</dt>
            <dd className="t-mono-cap text-[var(--t-3)]">
              {DATETIME_FMT.format(new Date(member.joinedAt))}
            </dd>
          </div>
        </dl>
      </Link>
    </HoverLift>
  );
}
