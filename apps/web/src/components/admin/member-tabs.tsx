import Link from 'next/link';

export type MemberTabKey =
  | 'overview'
  | 'trades'
  | 'training'
  | 'checkins'
  | 'mark-douglas'
  | 'weekly-reports'
  | 'notes';

interface MemberTabsProps {
  memberId: string;
  active: MemberTabKey;
}

interface TabDefinition {
  key: MemberTabKey;
  label: string;
}

const TABS: readonly TabDefinition[] = [
  { key: 'overview', label: "Vue d'ensemble" },
  { key: 'trades', label: 'Trades' },
  { key: 'training', label: 'Entraînement' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'mark-douglas', label: 'Mark Douglas' },
  { key: 'weekly-reports', label: 'Rapports IA' },
  { key: 'notes', label: 'Notes admin' },
];

/**
 * Tab strip for the admin member detail page (SPEC §7.7).
 *
 * Every tab is a real route: `overview` is the default page, the rest are
 * `?tab=<key>` segments resolved by `parseTab` in the page. Rendered as
 * `<Link>` + `aria-current="page"` (not a JS tab widget) so each view is a
 * shareable, back-button-friendly URL.
 */
export function MemberTabs({ memberId, active }: MemberTabsProps) {
  return (
    <nav
      aria-label="Onglets membre"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--border)]"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;

        const baseClasses = [
          'inline-flex min-h-11 items-center gap-2 rounded-t-md px-3 py-2 text-xs font-medium transition-colors',
          isActive
            ? 'border-accent bg-accent/10 text-foreground border-b-2 font-semibold'
            : 'text-muted hover:text-foreground border-b-2 border-transparent',
        ].join(' ');

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
