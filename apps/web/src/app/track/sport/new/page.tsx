import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Dumbbell } from 'lucide-react';

import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { SportHabitWizard } from '@/components/track/sport-habit-wizard';
import { auth } from '@/auth';

/**
 * V2.1.1 TRACK — Sport wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<SportHabitWizard>`
 * Client Component which handles the 2-step flow + Server Action submit.
 */

export const dynamic = 'force-dynamic';

export default async function TrackSportNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the masthead */}
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
        <header className="space-y-2">
          <Link
            href="/track"
            className="inline-flex min-h-6 items-center gap-2 px-2 py-2 text-[13px] font-medium text-[var(--t-3)] hover:text-[var(--t-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Retour au suivi
          </Link>
          <p className="t-eyebrow-lg text-[var(--acc)]">Pilier sport</p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="rounded-control grid h-12 w-12 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Dumbbell className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h1
              className="f-display h-rise text-[24px] font-semibold tracking-[-0.03em] text-[var(--t-1)] sm:text-[28px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Logger ton activité
            </h1>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
            ACSM : ≥ 150 min/semaine d&apos;activité modérée à soutenue (cadre FITT-VP). La
            régularité, pas le volume d&apos;une séance, stabilise ton humeur et ta régulation
            émotionnelle sur la semaine de trading.
          </p>
        </header>

        <SportHabitWizard />
      </div>
    </main>
  );
}
