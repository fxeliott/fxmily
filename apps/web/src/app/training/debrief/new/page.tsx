import { ArrowLeft, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { TrainingDebriefStatsPanel } from '@/components/training-debrief/training-debrief-stats-panel';
import {
  TrainingDebriefWizard,
  type TrainingDebriefPrefill,
} from '@/components/training-debrief/training-debrief-wizard';
import { getTrainingDebrief, loadTrainingDebriefStats } from '@/lib/training-debrief/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/training-debrief/week';

export const metadata = {
  title: 'Nouveau débrief training · Fxmily',
};

export const dynamic = 'force-dynamic';

/**
 * V1.3 — `/training/debrief/new` (SPEC §23.4).
 *
 * Server Component. Read-only process-stats panel of the CURRENT week
 * (recomputed from `TrainingTrade`/`TrainingAnnotation`, §21.5-safe, never
 * `resultR`/`outcome`) ABOVE the 4-step Steenbarger wizard. Re-submitting an
 * already-debriefed week upserts (prefill → edit). Cyan DS-v2 (§21.7).
 *
 * `weekStart` is server-derived (Europe/Paris, §23.7) — the wizard never
 * computes it client-side.
 */
export default async function NewTrainingDebriefPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const weekStart = currentParisWeekStart();
  const [stats, existing] = await Promise.all([
    loadTrainingDebriefStats(session.user.id, weekStart),
    getTrainingDebrief(session.user.id, weekStart),
  ]);

  const weekRange = formatWeekRangeFr(weekStart);
  const prefill: TrainingDebriefPrefill | undefined = existing
    ? {
        processStrengthOne: existing.processStrengthOne,
        processStrengthTwo: existing.processStrengthTwo,
        microAdjustment: existing.microAdjustment,
        transversalLesson: existing.transversalLesson,
      }
    : undefined;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient tone="cyan" />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-4">
          <Link
            href="/training/debrief"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Mes débriefs
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
              Mode entraînement · Débrief
            </span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {existing ? 'Reprendre mon débrief' : 'Débrief de la semaine'}
            </h1>
            <p className="t-cap text-[var(--t-3)]">Semaine du {weekRange}</p>
          </div>

          <DrawnRule tone="cyan" className="max-w-[220px]" />
        </header>

        <TrainingDebriefStatsPanel stats={stats} weekRangeLabel={weekRange} />

        <TrainingDebriefWizard weekStart={weekStart} {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
