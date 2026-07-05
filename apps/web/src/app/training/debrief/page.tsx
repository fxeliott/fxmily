import { ArrowLeft, ArrowRight, GraduationCap, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { TrainingDebriefCrisisBanner } from '@/components/training-debrief/training-debrief-crisis-banner';
import { TrainingDebriefTimeline } from '@/components/training-debrief/training-debrief-timeline';
import { btnVariants } from '@/components/ui/btn';
import { getTrainingDebrief, listMyRecentTrainingDebriefs } from '@/lib/training-debrief/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/training-debrief/week';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Débrief training',
};

export const dynamic = 'force-dynamic';

interface DebriefLandingProps {
  searchParams: Promise<{ crisis?: string; done?: string }>;
}

/**
 * V1.3 — `/training/debrief` landing (SPEC §23.4).
 *
 * Server Component. Cyan DS-v2 training chrome (mirror `/training`, NEVER
 * `.v18-theme` — §21.7). Hero + CTA + optional crisis banner (`?crisis=`) +
 * calm `?done=1` reveal (anti Black-Hat: no XP/streak/fanfare) + timeline of
 * the last ≤12 debriefs. Auth gate carbone (status active).
 */
export default async function TrainingDebriefLandingPage({ searchParams }: DebriefLandingProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const sp = await searchParams;
  const crisisLevel =
    sp.crisis === 'high' || sp.crisis === 'medium' ? (sp.crisis as 'high' | 'medium') : null;
  const justSubmitted = sp.done === '1';

  const weekStart = currentParisWeekStart();
  const [recent, thisWeek] = await Promise.all([
    listMyRecentTrainingDebriefs(session.user.id, 12),
    getTrainingDebrief(session.user.id, weekStart),
  ]);
  const weekRange = formatWeekRangeFr(weekStart);
  const ctaLabel = thisWeek
    ? 'Reprendre le débrief de la semaine'
    : 'Faire le débrief de la semaine';

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient tone="cyan" />
      <div className="page-stagger relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-4">
          <Link
            href="/training"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Entraînement
          </Link>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
                <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
                Mode entraînement · Débrief
              </span>
              <h1
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Mon débrief hebdo
              </h1>
            </div>
            <Link
              href="/training/debrief/new"
              className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
            >
              <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.75} />
              {ctaLabel}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </div>

          <DrawnRule tone="cyan" className="max-w-[220px]" />

          <p className="rounded-control border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
            Un recul hebdomadaire sur ta <strong className="text-[var(--t-1)]">pratique</strong>{' '}
            d&apos;entraînement : régularité, discipline, leçons. Pas de P&amp;L, pas d&apos;analyse
            de marché : ton débrief est isolé de ton edge réel, comme le reste du mode entraînement.
          </p>
        </header>

        {crisisLevel ? <TrainingDebriefCrisisBanner key={crisisLevel} level={crisisLevel} /> : null}

        {justSubmitted && !crisisLevel ? (
          <div
            role="status"
            data-slot="training-debrief-done"
            className="rounded-card-lg border border-[var(--cy-edge-soft)] p-4"
            style={{
              background: 'linear-gradient(135deg, var(--cy-dim-strong) 0%, var(--bg-2) 80%)',
            }}
          >
            <p className="t-eyebrow text-[var(--t-3)]">Enregistré</p>
            <p className="t-h3 mt-1 text-[var(--t-1)]">
              Ton débrief de la semaine est posé. Reviens dimanche prochain prendre du recul.
            </p>
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-h2 text-[var(--t-1)]">Tes débriefs récents</h2>
            <p className="t-cap text-[var(--t-3)]">
              {recent.length} / 12 · semaine {weekRange}
            </p>
          </div>
          <TrainingDebriefTimeline
            debriefs={recent}
            timezone={session.user.timezone || 'Europe/Paris'}
          />
        </section>
      </div>
    </main>
  );
}
