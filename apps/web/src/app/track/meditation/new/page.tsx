import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Brain } from 'lucide-react';

import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AlreadyLoggedNotice } from '@/components/track/already-logged-notice';
import { MeditationHabitWizard } from '@/components/track/meditation-habit-wizard';
import { localDateOf } from '@/lib/checkin/timezone';
import { listRecentHabitLogs } from '@/lib/habit/service';
import { findTodayHabitLog, meditationPrefillFromLog } from '@/lib/habit/today-log';
import { auth } from '@/auth';

/**
 * V2.1.1 TRACK — Méditation wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<MeditationHabitWizard>`
 * Client Component which handles the 2-step flow + Server Action submit.
 *
 * P3 fix — if méditation is already logged for the member-timezone today, the
 * wizard starts PREFILLED and an "already logged" notice makes re-submit-updates
 * explicit (pattern carbone `/review/new` #463).
 */

export const dynamic = 'force-dynamic';

export default async function TrackMeditationNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = localDateOf(new Date(), timezone);
  const existing = findTodayHabitLog(
    await listRecentHabitLogs(session.user.id, 1),
    today,
    'meditation',
  );
  const prefill = existing ? meditationPrefillFromLog(existing) : null;

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
          <p className="t-eyebrow-lg text-[var(--acc)]">Pilier méditation</p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="rounded-control grid h-12 w-12 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Brain className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h1
              className="f-display h-rise text-[24px] font-semibold tracking-[-0.03em] text-[var(--t-1)] sm:text-[28px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Logger ta méditation
            </h1>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
            Hofmann et al., <em>J. Consult. Clin. Psychol.</em>, 2010 (méta-analyse) : ~10 min/jour
            de pleine conscience suffisent à réduire l&apos;anxiété et stabiliser ta régulation
            émotionnelle, les deux leviers de ton exécution sous incertitude.
          </p>
        </header>

        {prefill ? <AlreadyLoggedNotice pillarLabel="Méditation" /> : null}

        <MeditationHabitWizard {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
