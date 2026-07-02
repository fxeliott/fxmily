import { ArrowLeft, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { EvolutionTraceCard } from '@/components/coaching/evolution-trace-card';
import { MentalMapCard } from '@/components/coaching/mental-map-card';
import { MicroObjectiveCard } from '@/components/coaching/micro-objective-card';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { CoachingAxisCard } from '@/components/objectives/coaching-axis-card';
import { JourneyRoadmap } from '@/components/objectives/journey-roadmap';
import { MethodGoalCard } from '@/components/objectives/method-goal-card';
import { NextSteps } from '@/components/objectives/next-steps';
import { ObjectiveRings } from '@/components/objectives/objective-rings';
import { ObjectivesHero } from '@/components/objectives/objectives-hero';
import { TrajectoryChart } from '@/components/objectives/trajectory-chart';
import { getOpenMicroObjective, listRecentMicroObjectives } from '@/lib/coaching/micro-objective';
import { getMentalMap } from '@/lib/coaching/service';
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
  // S5 §32 — the psychological coaching surfaces (E1 mental map, E3 open micro-
  // objective, E2 evolution trace) are loaded page-specifically here, in parallel
  // (no added wall-clock; all indexed reads). They live on /objectifs because this
  // is the "where I'm going / what to work on" prospective surface.
  const [view, mentalMap, openMicroObjective, microObjectiveTrace] = await Promise.all([
    getProcessObjectives(userId, timezone),
    getMentalMap(userId),
    getOpenMicroObjective(userId),
    listRecentMicroObjectives(userId),
  ]);

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
            Ta destination, ta trajectoire et tes gestes du jour, réunis. On vise le{' '}
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

        {/* 1.75 — D4 : le STADE d'apprentissage (Mécanique / Subjectif / Intuitif)
            dérivé du profil d'onboarding, DÉTERMINISTE (enum → libellé FR + phrase
            fixe orientant le plan). On ne rend que l'enum-dérivé, jamais le texte
            brut IA (`rationale`) ⇒ aucune bannière IA requise (AI Act §50). Rend
            null tant qu'aucun profil / champ absent. §2/§21.5-safe. */}
        {view.learningStage ? (
          <section className="wow-reveal" aria-labelledby="learning-stage-heading">
            <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5">
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="rounded-control mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-2)]"
                >
                  <GraduationCap className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="t-eyebrow text-[var(--t-3)]">Ton stade d’apprentissage</span>
                  <h2
                    id="learning-stage-heading"
                    className="t-body leading-[1.4] font-semibold text-[var(--t-1)]"
                  >
                    {view.learningStage.label}
                  </h2>
                  <p className="t-cap leading-relaxed text-[var(--t-2)]">
                    {view.learningStage.hint}
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* 1.8 — S5 §32-E1 : « Ta carte mentale ». Pour chaque signal de process,
            le triptyque observé → ce que ça signifie (Mark Douglas) → ton geste.
            Rend null sans signal (pas de conseil fabriqué). §2/§31.2-safe. */}
        {mentalMap.length > 0 ? (
          <section className="wow-reveal" aria-label="Ta carte mentale">
            <MentalMapCard entries={mentalMap} variant="full" />
          </section>
        ) : null}

        {/* 1.9 — S5 §32-E3 : le micro-objectif mental OUVERT (un seul à la fois) +
            le suivi qui referme la boucle au prochain passage. Rend null si aucune
            boucle ouverte. Déterministe, §2-safe. */}
        {openMicroObjective ? (
          <section className="wow-reveal" aria-label="Ton micro-objectif du moment">
            <MicroObjectiveCard objective={openMicroObjective} variant="full" />
          </section>
        ) : null}

        {/* 1.10 — S5 §32-E2 : la trace HORODATÉE des micro-objectifs (créé → refermé),
            lecture de l'évolution psychologique dans le temps. Rend null sans histo. */}
        {microObjectiveTrace.length > 0 ? (
          <section className="wow-reveal" aria-label="Ton évolution dans le temps">
            <EvolutionTraceCard items={microObjectiveTrace} timezone={timezone} />
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
          Le détail de tes scores et ta trajectoire passée · Où j’en suis
        </Link>
      </div>
    </main>
  );
}
