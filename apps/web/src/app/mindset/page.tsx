import { ArrowLeft, ArrowRight, Brain, ClipboardCheck, LineChart, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { MindsetDashboard } from '@/components/mindset/mindset-dashboard';
import { MindsetTimeline } from '@/components/mindset/mindset-timeline';
import { btnVariants } from '@/components/ui/btn';
import { SuccessState } from '@/components/ui/success-state';
import { CURRENT_MINDSET_INSTRUMENT_VERSION } from '@/lib/mindset/instrument';
import { loadMindsetDashboardData } from '@/lib/mindset/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/mindset/week';
import { cn } from '@/lib/utils';
import { NextStepRail } from '@/components/nav/next-step-rail';

export const metadata = {
  title: 'Mon mindset',
};

export const dynamic = 'force-dynamic';

interface MindsetLandingProps {
  searchParams: Promise<{ done?: string }>;
}

/**
 * V1.5 — `/mindset` landing (SPEC §27.4).
 *
 * Server Component, DS-v2 NEUTRAL (lime/neutral — NEVER cyan §21.7, NEVER
 * `.v18-theme`). Premium profile dashboard (radar + per-dimension trends +
 * strengths-based reading) + calm `?done=1` reveal (anti Black-Hat: no
 * XP/streak/fanfare) + timeline of the last ≤12 checks. 100 % deterministic
 * (zero AI → NO EU AI Act banner, §27.7), zero free-text (NO crisis banner).
 * Auth gate carbone (status active).
 */
export default async function MindsetLandingPage({ searchParams }: MindsetLandingProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const sp = await searchParams;
  const justSubmitted = sp.done === '1';

  const weekStart = currentParisWeekStart();
  const { recent, currentWeek, latestProfile, trend } = await loadMindsetDashboardData(
    session.user.id,
    weekStart,
    12,
  );
  const weekRange = formatWeekRangeFr(weekStart);
  const ctaLabel = currentWeek ? 'Reprendre mon auto-évaluation' : 'Faire mon auto-évaluation';

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the masthead */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 lg:px-8">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Tableau de bord
          </Link>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
                <Brain className="h-3.5 w-3.5" strokeWidth={2} />
                Mindset · Auto-évaluation
              </span>
              <h1
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Mon mindset hebdo
              </h1>
            </div>
            <Link href="/mindset/new" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
              <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              {ctaLabel}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </div>

          <DrawnRule className="max-w-[220px]" />

          <p className="rounded-control max-w-prose border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
            Un point hebdomadaire sur ton{' '}
            <strong className="text-[var(--t-1)]">état d&apos;esprit</strong> d&apos;athlète-trader
            (cadre Mark Douglas). Pas de bonne ni de mauvaise réponse, pas de P&amp;L, pas
            d&apos;analyse de marché, c&apos;est un instrument de recul, totalement séparé de ton
            score et de ton edge.
          </p>
        </header>

        <NextStepRail currentPath="/mindset" />

        {justSubmitted ? (
          <SuccessState size="block" headline="Enregistré">
            Ton auto-évaluation de la semaine est posée. Reviens lundi prochain prendre le même
            recul, sans pression.
          </SuccessState>
        ) : null}

        <div className="wow-reveal">
          <MindsetDashboard
            latestProfile={latestProfile}
            trend={trend}
            instrumentVersion={CURRENT_MINDSET_INSTRUMENT_VERSION}
          />
        </div>

        <section className="wow-reveal flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-h2 text-[var(--t-1)]">Tes auto-évaluations récentes</h2>
            <p className="t-cap text-[var(--t-3)]">
              {recent.length} / 12 · semaine {weekRange}
            </p>
          </div>
          <MindsetTimeline checks={recent} timezone={session.user.timezone || 'Europe/Paris'} />
        </section>

        {/* S19.2 — §11 : ferme le cul-de-sac mindset. L'auto-évaluation est un
            recul ; ces deux portes le transforment en pratique (réflexion du jour
            / revue de la semaine). Doorways bi-ton (bleu + indigo) — pas des CTA
            primaires, donc le mono-accent CTA reste intact. */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="mindset-next-heading">
          <h2 id="mindset-next-heading" className="t-eyebrow-lg text-[var(--t-3)]">
            Et maintenant ?
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/reflect"
              className="group rounded-card flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[var(--t-1)]">
                  Réflexion guidée
                </span>
                <span className="t-cap text-[var(--t-3)]">
                  Transformer ce recul en intention concrète
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-[var(--t-4)] transition-transform group-hover:translate-x-0.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/review"
              className="group rounded-card flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--acc-2-edge)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc-2-hi)]"
            >
              <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--acc-2-edge)] bg-[var(--acc-2-dim)] text-[var(--acc-2-hi)]">
                <LineChart className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[var(--t-1)]">
                  Revue de la semaine
                </span>
                <span className="t-cap text-[var(--t-3)]">Faire le point sur ton exécution</span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-[var(--t-4)] transition-transform group-hover:translate-x-0.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
