import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  FileBarChart,
  HeartPulse,
  Inbox,
  Library,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { Pill } from '@/components/ui/pill';
import { listPendingAccessRequests } from '@/lib/access-request/service';
import { getCohortAttention } from '@/lib/admin/attention-service';
import { getCatalogStats } from '@/lib/admin/cards-service';
import { getMemberDirectoryStats } from '@/lib/admin/members-service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Console · Admin',
};

export const dynamic = 'force-dynamic';

/**
 * S19.2 — `/admin` console hub. The 7 admin surfaces previously had NO landing:
 * an admin arrived via a deep nav link with no overview or triage entry point.
 * This is the aggregate-status pattern (PatternFly): a card per surface with a
 * live count badge, the urgent triage item (pending access requests) first
 * (F-pattern, top-left), badge colour = signal (warn when something waits).
 * Mono-accent discipline preserved: nav cards, not CTAs — the blue stays the CTA.
 */
export default async function AdminHubPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const [memberStats, pending, catalog, cohortAttention] = await Promise.all([
    getMemberDirectoryStats(),
    listPendingAccessRequests(),
    getCatalogStats(),
    getCohortAttention(),
  ]);
  const pendingCount = pending.length;
  // S7 §33-#2 — one triage number for the Members card: trades to comment + open
  // truth gaps. The hub already promises "attention first", so surface it here too.
  const triageCount = cohortAttention.tradesToComment + cohortAttention.openDiscrepancies;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[var(--w-app)] flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
      <DashboardAmbient />
      <header className="relative flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <Settings className="h-3.5 w-3.5" strokeWidth={2} />
            Administration
          </span>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Console
          </h1>
          <p className="t-lead max-w-prose">
            Tes espaces de pilotage. Ce qui demande ton attention apparaît en premier.
          </p>
        </div>
      </header>

      <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HubCard
          href="/admin/access-requests"
          icon={Inbox}
          label="Demandes d’accès"
          description="Valider ou refuser les demandes de la page publique."
          badge={
            pendingCount > 0 ? (
              <Pill tone="warn" dot>
                {pendingCount} en attente
              </Pill>
            ) : (
              <Pill tone="mute">À jour</Pill>
            )
          }
        />
        <HubCard
          href="/admin/members"
          icon={Users}
          label="Membres"
          description="Annuaire de la cohorte, profils et supervision."
          badge={
            <div className="flex flex-col items-end gap-1">
              <Pill tone="acc">
                <AnimatedNumber value={memberStats.total} /> membre
                {memberStats.total > 1 ? 's' : ''}
              </Pill>
              {triageCount > 0 ? (
                <Pill tone="warn" dot>
                  {triageCount} à traiter
                </Pill>
              ) : null}
            </div>
          }
        />
        <HubCard
          href="/admin/cards"
          icon={Library}
          label="Fiches Douglas"
          description="Bibliothèque de fiches mentales et leur diffusion."
          badge={
            <Pill tone="acc">
              <AnimatedNumber value={catalog.totalCards} /> fiche{catalog.totalCards > 1 ? 's' : ''}
            </Pill>
          }
        />
        <HubCard
          href="/admin/reunions"
          icon={CalendarRange}
          label="Réunions"
          description="Créneaux et assiduité des membres aux réunions."
        />
        <HubCard
          href="/admin/reports"
          icon={FileBarChart}
          label="Rapports"
          description="Synthèses IA mensuelles et débriefs des membres."
        />
        <HubCard
          href="/admin/health"
          icon={HeartPulse}
          label="Santé métier"
          description="La chaîne tourne : remplissage, écarts, présence, score."
          badge={
            cohortAttention.openDiscrepancies > 0 ? (
              <Pill tone="warn" dot>
                {cohortAttention.openDiscrepancies} écart
                {cohortAttention.openDiscrepancies > 1 ? 's' : ''} ouvert
                {cohortAttention.openDiscrepancies > 1 ? 's' : ''}
              </Pill>
            ) : (
              <Pill tone="mute">À jour</Pill>
            )
          }
        />
        <HubCard
          href="/admin/system"
          icon={Settings}
          label="Système"
          description="Santé des crons, snapshots et observabilité."
        />
      </div>
    </main>
  );
}

/** One aggregate-status nav card. Icon chip + label + description + optional live
 *  count badge. Premium hover (compositor-only spring lift + accent halo). */
function HubCard({
  href,
  icon: Icon,
  label,
  description,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <HoverGlowLift tone="acc" className={cn('rounded-card-lg h-full')}>
      <Link
        href={href}
        className="rounded-card-lg group flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-5 transition-colors hover:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-control grid h-10 w-10 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          {badge ?? null}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-[var(--t-1)]">{label}</h2>
          <p className="t-cap leading-relaxed text-[var(--t-3)]">{description}</p>
        </div>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--acc-hi)]">
          Ouvrir
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
      </Link>
    </HoverGlowLift>
  );
}
