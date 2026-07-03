import { ArrowLeft, Clapperboard } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { SeanceCard } from '@/components/seances/seance-card';
import { SeancesDisclaimer } from '@/components/seances/seances-disclaimer';
import { SeancesStatGrid } from '@/components/seances/seances-stat-grid';
import { getSeancesHub } from '@/lib/seances/service';
import { NextStepRail } from '@/components/nav/next-step-rail';

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

  const { stats, featuredDay, days, latestDoneId, hasPublished } = await getSeancesHub();

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
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
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Les séances
            </h1>
            <p className="t-cap max-w-prose text-[var(--t-3)]">
              Le replay de chaque séance et son analyse, actif par actif. Rattrape une réunion que
              tu as manquée, ou revois un point précis quand tu veux.
            </p>
          </div>
        </header>

        <NextStepRail currentPath="/seances" />

        <SeancesStatGrid stats={stats} />

        {/* À la une — most recent day with a done session. */}
        {featuredDay ? (
          <section
            aria-labelledby="seances-featured-heading"
            className="wow-reveal flex flex-col gap-3"
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
            <div className="rounded-card border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] p-6 text-center">
              <p className="t-body text-[var(--t-2)]">Le hub est prêt.</p>
              <p className="t-cap mt-1 text-[var(--t-3)]">
                Les replays et comptes rendus des séances apparaîtront ici dès la première séance
                publiée.
              </p>
            </div>
          )}
        </section>

        <SeancesDisclaimer />
      </div>
    </main>
  );
}
