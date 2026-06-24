import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { CoachingAxisCard } from '@/components/objectives/coaching-axis-card';
import { JourneyRoadmap } from '@/components/objectives/journey-roadmap';
import { MethodGoalCard } from '@/components/objectives/method-goal-card';
import { NextSteps } from '@/components/objectives/next-steps';
import { ObjectiveRings } from '@/components/objectives/objective-rings';
import { ObjectivesHero } from '@/components/objectives/objectives-hero';
import { TrajectoryChart } from '@/components/objectives/trajectory-chart';
import { getProcessObjectives } from '@/lib/objectives/service';

/**
 * « Mes objectifs · Où je vais » — jalon J4 (intention de guidage #2).
 *
 * Transforme l'ancienne coquille en page prospective : où j'en suis (cap +
 * trajectoire), mes objectifs de PROCESS (anneaux vers la Maîtrise), où je vais
 * (projection honnête), le chemin (parcours en 4 paliers) et ce que je dois
 * faire (actions guidées). Données DÉRIVÉES de l'existant — aucune table neuve,
 * aucune cible de P&L (posture §2). Le pendant rétrospectif vit dans « Où j'en
 * suis » (/progression).
 */
export const metadata = {
  title: 'Mes objectifs',
};
export const dynamic = 'force-dynamic';

export default async function ObjectifsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = session.user.id;
  if (!userId) redirect('/login');
  const timezone = session.user.timezone || 'Europe/Paris';

  // S24 — the weekly coaching axis (from the onboarding profile) is now derived
  // ONCE inside `getProcessObjectives` (shared with the dashboard hub), so the
  // page no longer reads the profile itself nor owns the coercion/rotation.
  const view = await getProcessObjectives(userId, timezone);

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        <header className="flex flex-col gap-2">
          <span className="t-eyebrow text-[var(--t-3)]">Ma progression</span>
          <h1
            className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
            style={{
              fontFeatureSettings: '"ss01" 1',
              fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
            }}
          >
            Mes objectifs
          </h1>
          <p className="t-lead max-w-[62ch]">
            Ta destination, ta trajectoire et tes gestes du jour — réunis. On vise le{' '}
            <strong className="text-[var(--t-1)]">process</strong>, jamais le profit : seulement ce
            que tu contrôles.
          </p>
        </header>

        {/* 1. Où j'en suis + ma prochaine étape */}
        <section className="wow-reveal" aria-labelledby="hero-heading">
          <h2 id="hero-heading" className="sr-only">
            Où j’en suis aujourd’hui
          </h2>
          <ObjectivesHero view={view} />
        </section>

        {/* 1.5 — S12/S24 : l'axe de coaching de la semaine (issu du profil
            onboarding), désormais rendu via le composant partagé `CoachingAxisCard`
            (même surface sur le dashboard). Descriptif, §2-safe, badge IA. */}
        {view.coachingAxis ? (
          <section className="wow-reveal" aria-labelledby="coaching-axis-heading">
            <CoachingAxisCard axis={view.coachingAxis} variant="full" />
          </section>
        ) : null}

        {/* 1.7 — S25 : l'objectif de méthode DÉRIVÉ de sa donnée réelle (la règle
            dure la plus faible sur 30j) + palier doux. Complète l'axe STATED
            ci-dessus (intention onboarding) par un objectif MESURÉ qui évolue avec
            sa pratique. Déterministe (pas de badge IA), §2-safe. Rend null tant
            qu'il n'a pas assez de trades / est déjà fidèle partout. */}
        {view.methodGoal ? (
          <section className="wow-reveal" aria-label="Ton objectif de méthode du moment">
            <MethodGoalCard goal={view.methodGoal} variant="full" />
          </section>
        ) : null}

        {/* 2. Mes objectifs de process (anneaux vers la Maîtrise) */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="rings-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="rings-heading" className="t-eyebrow">
              Tes objectifs de process
            </h2>
            <span className="t-cap text-[var(--t-4)]">
              {view.hasScores
                ? 'Cible : atteindre la Maîtrise (85) sur chaque dimension'
                : 'Activés après tes premiers check-ins et trades clôturés'}
            </span>
          </div>
          <ObjectiveRings objectives={view.objectives} />
        </section>

        {/* 3. Où je vais — projection de trajectoire */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="trajectory-heading">
          <h2 id="trajectory-heading" className="sr-only">
            Ta trajectoire vers la Maîtrise
          </h2>
          <TrajectoryChart trajectory={view.trajectory} />
        </section>

        {/* 4. Le chemin — parcours en 4 paliers */}
        <div className="wow-reveal">
          <JourneyRoadmap stages={view.journey} cap={view.cap} />
        </div>

        {/* 5. Ce que tu dois faire */}
        <div className="wow-reveal">
          <NextSteps actions={view.nextActions} focus={view.focus} />
        </div>

        {/* S19 — pont réciproque vers le pendant RÉTROSPECTIF (« Où j'en suis »). */}
        <Link
          href="/progression"
          className="rounded-card group flex items-center gap-2 self-start text-[13px] font-medium text-[var(--t-3)] transition-colors hover:text-[var(--acc-hi)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <ArrowLeft
            className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          Le détail de tes scores et ta trajectoire passée — Où j’en suis
        </Link>
      </div>
    </main>
  );
}
