import Link from 'next/link';

export type MemberTabKey = 'overview' | 'trades' | 'checkins' | 'mark-douglas' | 'notes';

interface MemberTabsProps {
  memberId: string;
  active: MemberTabKey;
}

interface TabDefinition {
  key: MemberTabKey;
  label: string;
  /** Hint shown for tabs not yet wired (J5+ features). */
  comingSoon?: string;
}

const TABS: readonly TabDefinition[] = [
  { key: 'overview', label: "Vue d'ensemble" },
  { key: 'trades', label: 'Trades' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'mark-douglas', label: 'Mark Douglas' },
  { key: 'notes', label: 'Notes admin', comingSoon: 'J3.5' },
];

/**
 * Tab strip for the admin member detail page (J3, SPEC §7.7).
 *
 * Implemented with `<Link>` + `aria-current="page"` rather than a JS-driven
 * tab pattern: each tab is a real route segment in J5+, and at J3 only the
 * first two tabs go to real URLs (`overview` is the default page,
 * `trades` is `?tab=trades`). The disabled tabs render as muted spans with
 * a "Bientôt" badge so the admin can see the roadmap.
 */
export function MemberTabs({ memberId, active }: MemberTabsProps) {
  return (
    <nav
      aria-label="Onglets membre"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--border)]"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const isDisabled = Boolean(tab.comingSoon);

        const baseClasses = [
          'inline-flex min-h-11 items-center gap-2 rounded-t-md px-3 py-2 text-xs font-medium transition-colors',
          isActive
            ? 'border-accent bg-accent/10 text-foreground border-b-2 font-semibold'
            : 'text-muted hover:text-foreground border-b-2 border-transparent',
          isDisabled ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ');

        if (isDisabled) {
          return (
            <span
              key={tab.key}
              className={baseClasses}
              aria-disabled="true"
              title={`Disponible en ${tab.comingSoon}`}
            >
              {tab.label}
              <span className="text-muted text-[10px] uppercase tracking-wider">
                {tab.comingSoon}
              </span>
            </span>
          );
        }

        const href =
          tab.key === 'overview'
            ? `/admin/members/${memberId}`
            : `/admin/members/${memberId}?tab=${tab.key}`;

        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={[
              baseClasses,
              'focus-visible:outline-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
