import {
  Activity,
  ArrowLeft,
  CalendarCheck,
  HeartPulse,
  Scale,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import {
  HealthMetric,
  HealthSection,
  NetDirectionPill,
} from '@/components/admin/system-health-section';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { getSystemHealthOverview } from '@/lib/admin/system-health-service';
import { logAudit } from '@/lib/auth/audit';

/**
 * `/admin/health` — BUSINESS-CHAIN health view (S10(a)).
 *
 * One cohort-wide page answering « la chaîne métier tourne-t-elle ? »: check-in
 * fill, truth gaps by status, meeting-presence recoupements, and recent score
 * movements (who moved and why). DISTINCT from `/admin/system` (crons OPS) — a
 * cross-link at the foot acts the métier-vs-infra split.
 *
 * Server Component, pure SSR, auth-gated to an ACTIVE admin (carbon of the
 * system page gate). READ-ONLY: the only write is the `admin.health.viewed`
 * access trace. Posture §2: counts/facts only, calm tones (acc/warn/mute),
 * never a punitive red, never market advice, never capture content.
 */

export const metadata: Metadata = {
  title: 'Santé métier · Admin',
  description:
    'Vue cohorte de la chaîne métier : remplissage check-ins, écarts de vérité, présence réunions, mouvements de score.',
};
export const dynamic = 'force-dynamic';

export default async function AdminHealthPage(): Promise<React.ReactElement> {
  const session = await auth();
  // Identical gate to /admin/system: a soft-deleted admin keeps a valid JWT for
  // up to 30d, so we lock on `status === 'active'` too (defense in depth).
  if (!session?.user || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login?redirect=/admin/health');
  }

  const overview = await getSystemHealthOverview();

  await logAudit({ action: 'admin.health.viewed', userId: session.user.id });

  const { checkins, truthGaps, meetings, scoreMovements, recentAlerts, windows } = overview;
  const recentWindow = `${windows.checkinDays} derniers jours`;
  const meetingWindow = `Fenêtre ±${windows.meetingDays} jours`;

  return (
    <main className="relative mx-auto w-full max-w-[var(--w-app)] px-4 py-6 sm:py-10 lg:px-8 2xl:px-12">
      <DashboardAmbient />
      <header className="relative mb-6">
        <Link
          href="/admin"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour à la console admin"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Console
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.18em] text-[var(--acc)] uppercase">
          Santé métier
        </p>
        <h1
          className="f-display h-rise mt-2 flex items-center gap-3 text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          <HeartPulse aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
          La chaîne tourne
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
          Une lecture unique de la cohorte : remplissage des rituels, honnêteté &amp; écarts,
          recoupements de présence et mouvements de score. Des faits, des comptes, jamais un verdict
          ni un conseil de marché (posture §2). Calculé à {formatTime(overview.computedAt)}.
        </p>
        {/* Tour 13 — turn the read into action: from a global count, one click to
            the members that need work. Shown only when something waits. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {truthGaps.open > 0 ? (
            <Link
              href="/admin/members?attention=1"
              className={btnVariants({ kind: 'secondary', size: 'm' })}
            >
              <Scale aria-hidden="true" className="h-4 w-4" />
              Voir les membres à traiter
            </Link>
          ) : null}
          <Link href="/admin/members" className={btnVariants({ kind: 'ghost', size: 'm' })}>
            <Users aria-hidden="true" className="h-4 w-4" />
            Tous les membres
          </Link>
        </div>
      </header>

      <div className="relative flex flex-col gap-6">
        {/* 1. Chaîne de remplissage — le rituel quotidien est-il vivant ? */}
        <HealthSection icon={CalendarCheck} title="Chaîne de remplissage" window={recentWindow}>
          <HealthMetric
            label="Check-ins récents"
            value={checkins.recentCheckins}
            sublabel="rituels (matin/soir) saisis sur la fenêtre"
            tone={checkins.recentCheckins > 0 ? 'acc' : 'mute'}
          />
        </HealthSection>

        {/* 2. Honnêteté & écarts — les écarts de vérité, par statut. */}
        <HealthSection
          icon={Scale}
          title="Honnêteté & écarts"
          window="Tous écarts (cohorte active)"
        >
          <HealthMetric
            label="Écarts ouverts"
            value={truthGaps.open}
            sublabel="en attente d’un motif ou d’un suivi"
            tone={truthGaps.open > 0 ? 'warn' : 'mute'}
            {...(truthGaps.open > 0
              ? {
                  href: '/admin/members?attention=1',
                  linkLabel: `Voir les ${truthGaps.open} membre${truthGaps.open > 1 ? 's' : ''} avec un écart ouvert`,
                }
              : {})}
          />
          <HealthMetric
            label="Pris en compte"
            value={truthGaps.acknowledged}
            sublabel="le membre a fait face (acknowledged)"
          />
          <HealthMetric
            label="Résolus"
            value={truthGaps.resolved}
            sublabel="levés par la réalité ou un motif valable"
            tone="mute"
          />
        </HealthSection>

        {/* 3. Présence réunions + recoupements admin↔membre. */}
        <HealthSection icon={CalendarCheck} title="Présence réunions" window={meetingWindow}>
          <HealthMetric
            label="Réunions"
            value={meetings.meetings}
            sublabel="créneaux récents + à venir"
          />
          <HealthMetric
            label="Suivies (complètes)"
            value={meetings.completed}
            sublabel="présences complètes déclarées"
          />
          <HealthMetric
            label="Recoupements à voir"
            value={meetings.gaps}
            sublabel="écarts présence admin↔membre"
            tone={meetings.gaps > 0 ? 'warn' : 'mute'}
          />
        </HealthSection>

        {/* 4. Mouvements de score — qui a bougé et pourquoi (ScoreEvent.reason). */}
        <HealthSection icon={TrendingUp} title="Mouvements de score" window={recentWindow}>
          <HealthMetric
            label="Travail fait"
            value={scoreMovements.filled}
            sublabel="rituels remplis (filled, +)"
          />
          <HealthMetric
            label="Oublis sans motif"
            value={scoreMovements.forgot_no_reason}
            sublabel="rituels manqués (forgot_no_reason)"
            tone={scoreMovements.forgot_no_reason > 0 ? 'warn' : 'mute'}
          />
          <HealthMetric
            label="Écarts vérité"
            value={scoreMovements.reality_gap}
            sublabel="déclaré ↔ réel (reality_gap)"
            tone={scoreMovements.reality_gap > 0 ? 'warn' : 'mute'}
          />
          <HealthMetric
            label="Déclarations infondées"
            value={scoreMovements.false_declaration}
            sublabel="trade déclaré sans contrepartie (false_declaration)"
            tone={scoreMovements.false_declaration > 0 ? 'warn' : 'mute'}
          />
          <div className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3">
            <p className="text-[11px] font-medium tracking-wide text-[var(--t-3)] uppercase">
              Direction nette
            </p>
            <div className="mt-2 flex items-center gap-2">
              <NetDirectionPill net={scoreMovements.net} />
              <span className="text-[11px] text-[var(--t-4)]">
                sur {scoreMovements.total} mouvement{scoreMovements.total > 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3">
            <p className="text-[11px] font-medium tracking-wide text-[var(--t-3)] uppercase">
              Relances (répétition)
            </p>
            <div className="mt-2 flex items-center gap-2">
              {recentAlerts > 0 ? (
                <Pill tone="warn" dot>
                  {recentAlerts} alerte{recentAlerts > 1 ? 's' : ''}
                </Pill>
              ) : (
                <Pill tone="mute">Aucune</Pill>
              )}
              <span className="text-[11px] text-[var(--t-4)]">accompagnement Mark Douglas</span>
            </div>
          </div>
        </HealthSection>
      </div>

      <p className="mt-8 flex items-start gap-1.5 text-[11px] text-[var(--t-3)]">
        <Activity aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--acc-hi)]" />
        <span>
          Cette vue suit la <strong>chaîne métier</strong> (la cohorte avance-t-elle). Pour les{' '}
          <Link
            href="/admin/system"
            className="font-medium text-[var(--acc-hi)] underline-offset-2 hover:underline"
          >
            heartbeats des crons
          </Link>{' '}
          (l’infrastructure tourne-t-elle), voir l’état système.
        </span>
      </p>
    </main>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
