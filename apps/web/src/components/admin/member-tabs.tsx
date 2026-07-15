import Link from 'next/link';

export type MemberTabKey =
  | 'overview'
  | 'trades'
  | 'training'
  | 'checkins'
  | 'off-days'
  | 'pretrade'
  | 'mark-douglas'
  | 'weekly-reports'
  | 'monthly-debrief'
  | 'mindset'
  | 'calendar'
  | 'profile'
  | 'trajectoire'
  | 'presence'
  | 'verification'
  | 'notes'
  | 'moderation';

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
  // J3 "classement pour tous" SCOPE 4 — admin read-only view of the member's
  // self-declared off days in the forward cap window: which are motivated
  // (reason attached, past the free cap) vs free, and whether they are over cap.
  // The "visible admin" half of the anti-gaming lever.
  { key: 'off-days', label: 'Jours off' },
  // S7 §22-23 — admin read-only view of the member's pre-trade discipline
  // (reason to trade, plan alignment, SL pre-defined, reason×outcome).
  // Reuses the member-facing userId-scoped cards. Carbone pattern §7.7.
  { key: 'pretrade', label: 'Pré-trade' },
  { key: 'mark-douglas', label: 'Mark Douglas' },
  { key: 'weekly-reports', label: 'Rapports IA' },
  { key: 'monthly-debrief', label: 'Débrief mensuel' },
  { key: 'mindset', label: 'Mindset' },
  // §26 J-C4 — admin read-only view of the member's latest AdaptiveCalendar
  // (post-J-C1/J-C2/J-C3 LIVE). Carbone pattern §7.7 admin-only read-only.
  { key: 'calendar', label: 'Calendrier' },
  // V2.4 Phase C — admin pseudonymized view of MemberProfile (post-V2.4 Phase B
  // onboarding interview LIVE). Carbone pattern §7.7 admin-only read-only.
  { key: 'profile', label: 'Profil' },
  // J-E inc.3 — admin read-only monthly trajectory of the 4 deep AI dimensions
  // (re-profiled each civil month). Sits right after the onboarding baseline
  // (`profile`): baseline portrait then month-over-month evolution.
  { key: 'trajectoire', label: 'Trajectoire' },
  // V1.7 §30 J-M3 — admin read-only view of the member's meeting attendance
  // (rate + per-meeting detail). Carbone pattern §7.7 admin-only read-only.
  { key: 'presence', label: 'Présence' },
  // S3 §33 — admin view of the reality-vs-declared surface (accounts, proofs,
  // écarts, constancy score, alerts). Carbone pattern §7.7 admin read-only.
  { key: 'verification', label: 'Vérification' },
  { key: 'notes', label: 'Notes admin' },
  // F5 (overhaul 2026-06-30) — admin-only moderation: suspend (expel) /
  // reinstate a member with an optional motif + append-only history. The member
  // never sees this tab. Carbone pattern §7.7 admin-only.
  { key: 'moderation', label: 'Modération' },
];

/**
 * Label lookup for a tab key — single source of truth shared with the
 * member-detail breadcrumb (so the « Onglet » crumb never drifts from the tab
 * strip). Derived from `TABS` so adding a tab keeps both in sync.
 */
export const MEMBER_TAB_LABEL: Readonly<Record<MemberTabKey, string>> = Object.fromEntries(
  TABS.map((t) => [t.key, t.label]),
) as Record<MemberTabKey, string>;

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
      className="flex snap-x snap-mandatory [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b border-[var(--b-default)] [-ms-overflow-style:none] md:flex-wrap md:overflow-visible [&>a]:shrink-0 [&>a]:snap-start"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;

        const baseClasses = [
          'inline-flex min-h-11 items-center gap-2 rounded-t-md px-3 py-2 text-xs font-medium transition-colors',
          isActive
            ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--t-1)] border-b-2 font-semibold'
            : 'text-[var(--t-3)] hover:text-[var(--t-1)] border-b-2 border-transparent',
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
