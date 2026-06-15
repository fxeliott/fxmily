import { ArrowLeft, Brain } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { MindsetCheckWizard, type MindsetCheckPrefill } from '@/components/mindset/mindset-wizard';
import { getMindsetCheck } from '@/lib/mindset/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/mindset/week';

export const metadata = {
  title: 'Auto-évaluation mindset · Fxmily',
};

export const dynamic = 'force-dynamic';

/**
 * V1.5 — `/mindset/new` (SPEC §27.4).
 *
 * Server Component, DS-v2 NEUTRAL. The Likert instrument (frozen, versioned).
 * Re-submitting an already-done week upserts (prefill → edit). `weekStart` is
 * server-derived (Europe/Paris, §27.7) — the wizard never computes it
 * client-side. No pre-submit panel (the instrument IS the surface; mindset
 * has no real/training stats — psychology-pure, §27.7).
 */
export default async function NewMindsetCheckPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const weekStart = currentParisWeekStart();
  const existing = await getMindsetCheck(session.user.id, weekStart);

  const weekRange = formatWeekRangeFr(weekStart);
  const prefill: MindsetCheckPrefill | undefined = existing
    ? { instrumentVersion: existing.instrumentVersion, responses: existing.responses }
    : undefined;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the glass wizard */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4">
          <Link
            href="/mindset"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Mon mindset
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Brain className="h-3.5 w-3.5" strokeWidth={2} />
              Mindset · Auto-évaluation
            </span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {existing ? 'Reprendre mon auto-évaluation' : 'Auto-évaluation de la semaine'}
            </h1>
            <p className="t-cap text-[var(--t-3)]">Semaine du {weekRange}</p>
          </div>
          <DrawnRule className="max-w-[220px]" />
        </header>

        <MindsetCheckWizard weekStart={weekStart} {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
