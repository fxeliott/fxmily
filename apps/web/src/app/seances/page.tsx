import { ArrowLeft, Clapperboard, PlaySquare } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { EquityCurve } from '@/components/illustrations/equity-curve';
import { EmptyState } from '@/components/ui/empty-state';
import { SeanceCard } from '@/components/seances/seance-card';
import { SeancesDisclaimer } from '@/components/seances/seances-disclaimer';
import { SeancesStatGrid } from '@/components/seances/seances-stat-grid';
import { getSeancesHub } from '@/lib/seances/service';
import { NextStepRail } from '@/components/nav/next-step-rail';
import { CoachingAxisLine } from '@/components/coaching/coaching-axis-line';
import { getDominantMentalAxis } from '@/lib/coaching/service';

export const metadata = {
  title: 'Séances',
};

export const dynamic = 'force-dynamic';

/**
 * Réunion Trading Hub — member landing `/seances` (re-platform J2).
 *
 * Server Component, DS-v3 NEUTRAL/accent (never `.v18-theme`, never cyan §21.7).
 * Auth-gated `status === 'active'`. Lists the published replays + faithful
 * summaries of Eliott's live meetings (done + cancelled-greyed); `scheduled`
 * sessions are never exposed. Posture §2 / Règle n°1: replays + faithful
 * recaps of the coach's own formation — NOT the app emitting trade advice.
 */
export default async function SeancesPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const [{ stats, featuredDay, days, latestDoneId, hasPublished }, dominantAxis] =
    await Promise.all([
      getSeancesHub(),
      // Tour 12 (action 4) — dominant mental axis for the coaching line. `null`
      // for un-profiled members → the line renders nothing (null-safe).
      getDominantMentalAxis(session.user.id),
    ]);

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      {/* Tour 12 — `page-stagger` cascades the direct sections in on navigation.
          The two `wow-reveal` sections below carry their OWN scroll-driven
          entrance, so they opt OUT via `data-self-animate` (else the two would
          fight over animation/opacity — double-fade at best, stuck at opacity:0
          at worst). No fixed descendant here (DashboardAmbient is an absolute
          sibling, the app-shell nav is an ancestor), so the transform creates no
          containing block for a fixed element. */}
      <div className="page-stagger relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Tableau de bord
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Clapperboard className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Réunion Trading Hub · Replays
            </span>
            <h1
              id="seances-heading"
              className="f-display h-rise text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Les séances
            </h1>
            <p className="t-lead max-w-prose text-[var(--t-3)]">
              Le replay de chaque séance et son analyse, actif par actif. Rattrape une réunion que
              tu as manquée, ou revois un point précis quand tu veux.
            </p>
          </div>
        </header>

        <NextStepRail currentPath="/seances" />

        {/* Tour 12 (action 4) — coaching line: this route was profile-blind.
            Null-safe (no profile → renders nothing). */}
        <CoachingAxisLine axis={dominantAxis} page="seances" />

        <SeancesStatGrid stats={stats} />

        {/* À la une — most recent day with a done session. */}
        {featuredDay ? (
          <section
            aria-labelledby="seances-featured-heading"
            className="wow-reveal flex flex-col gap-3"
            data-self-animate
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="seances-featured-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                À la une
              </h2>
              <span className="t-cap text-[var(--t-3)]">{featuredDay.label}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featuredDay.items.map((item) => (
                <SeanceCard key={item.id} item={item} isLatest={item.id === latestDoneId} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Archives — every published day, newest-first. */}
        <section
          aria-labelledby="seances-archive-heading"
          className="wow-reveal flex flex-col gap-4"
          data-self-animate
        >
          <h2 id="seances-archive-heading" className="t-eyebrow-lg text-[var(--t-3)]">
            Toutes les séances
          </h2>

          {hasPublished ? (
            <div className="flex flex-col gap-6">
              {days.map((day) => (
                <div key={day.date} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="t-cap font-mono text-[var(--t-2)]">{day.label}</span>
                    <span aria-hidden className="h-px flex-1 bg-[var(--b-default)]" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {day.items.map((item) => (
                      <SeanceCard key={item.id} item={item} isLatest={item.id === latestDoneId} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={PlaySquare}
              illustration={<EquityCurve className="mx-auto w-full max-w-[200px]" />}
              headline="Le hub est prêt."
              lead="Chaque séance de la semaine y sera déposée en replay, avec son analyse actif par actif, dès qu’elle est publiée."
              guides={[
                'Les séances de Réunion Trading ont lieu en semaine, en direct.',
                'Le replay et le compte rendu arrivent ici juste après.',
                'Rien à rattraper pour l’instant, tu es à jour.',
              ]}
              tip="Reviens quand une première séance est publiée, tu la retrouveras ici avec son analyse complète."
              ctaPrimary="Voir mon calendrier"
              ctaHref="/calendrier"
            />
          )}
        </section>

        <SeancesDisclaimer />
      </div>
    </main>
  );
}
