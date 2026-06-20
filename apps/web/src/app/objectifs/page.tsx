import { Target } from 'lucide-react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { JourneyRoadmap } from '@/components/objectives/journey-roadmap';
import { NextSteps } from '@/components/objectives/next-steps';
import { ObjectiveRings } from '@/components/objectives/objective-rings';
import { ObjectivesHero } from '@/components/objectives/objectives-hero';
import { TrajectoryChart } from '@/components/objectives/trajectory-chart';
import { getProcessObjectives } from '@/lib/objectives/service';
import { getProfileForUser } from '@/lib/onboarding-interview/service';

/** Coerce the JSON `axesPrioritaires` blob to a clean string list (mirrors /profile). */
function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

/**
 * Pick ONE axis to surface, rotating weekly so all axes are seen over time.
 * `now = new Date()` lives in the default param (same pattern as the dashboard's
 * `greeting()`/`frenchToday()`) — keeps the clock read out of the render body so
 * the react-hooks/purity rule stays happy.
 */
function pickCoachingAxis(axes: string[], now = new Date()): string | null {
  if (axes.length === 0) return null;
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  return axes[week % axes.length] ?? null;
}

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

  const [view, profile] = await Promise.all([
    getProcessObjectives(userId, timezone),
    getProfileForUser(userId),
  ]);

  // S12 — surface ONE coaching axis from the onboarding profile, rotating weekly,
  // so the personalised "points à travailler" finally appears in normal use
  // instead of dead-ending on /profile. Descriptive (process / discipline),
  // never a market call — same data already shown verbatim on /profile + admin +
  // monthly debrief. AI-derived ⇒ carries the AIGeneratedBanner (EU AI Act §50).
  const coachingAxis = pickCoachingAxis(asStringArray(profile?.axesPrioritaires));

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

        {/* 1.5 — S12 : l'axe de coaching de la semaine (issu du profil onboarding).
            Ferme le cul-de-sac « axes jamais revus en usage normal ». Descriptif,
            §2-safe, badge IA (axes dérivés Claude). */}
        {coachingAxis ? (
          <section className="wow-reveal" aria-labelledby="coaching-axis-heading">
            <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="rounded-control mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)]/50 text-[var(--acc)]"
                >
                  <Target className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="t-eyebrow text-[var(--acc)]">
                    Ton axe de coaching cette semaine
                  </span>
                  <h2
                    id="coaching-axis-heading"
                    className="t-body leading-[1.5] font-semibold break-words text-[var(--t-1)]"
                  >
                    {coachingAxis}
                  </h2>
                  <p className="t-cap text-[var(--t-3)]">
                    Issu de ton profil.{' '}
                    <a
                      href="/profile"
                      className="font-medium text-[var(--acc)] underline decoration-[var(--b-acc)] decoration-2 underline-offset-2 transition-colors hover:text-[var(--acc-hi)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                    >
                      Voir tous tes axes →
                    </a>
                  </p>
                </div>
              </div>
              <AIGeneratedBanner variant="badge" />
            </div>
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
      </div>
    </main>
  );
}
