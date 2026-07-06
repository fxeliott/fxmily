import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Coffee } from 'lucide-react';

import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AlreadyLoggedNotice } from '@/components/track/already-logged-notice';
import { CaffeineHabitWizard } from '@/components/track/caffeine-habit-wizard';
import { localDateOf } from '@/lib/checkin/timezone';
import { listRecentHabitLogs } from '@/lib/habit/service';
import { caffeinePrefillFromLog, findTodayHabitLog } from '@/lib/habit/today-log';
import { auth } from '@/auth';

/**
 * V2.1.1 TRACK — Café wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<CaffeineHabitWizard>`
 * Client Component which handles the 2-step flow + Server Action submit.
 *
 * P3 fix — if café is already logged for the member-timezone today, the wizard
 * starts PREFILLED and an "already logged" notice makes re-submit-updates
 * explicit (pattern carbone `/review/new` #463).
 */

export const dynamic = 'force-dynamic';

export default async function TrackCaffeineNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = localDateOf(new Date(), timezone);
  const existing = findTodayHabitLog(
    await listRecentHabitLogs(session.user.id, 1),
    today,
    'caffeine',
  );
  const prefill = existing ? caffeinePrefillFromLog(existing) : null;

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
          <p className="t-eyebrow-lg text-[var(--acc)]">Pilier café</p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="rounded-control grid h-12 w-12 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Coffee className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h1
              className="f-display h-rise text-[24px] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[28px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Logger ta caféine
            </h1>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
            Bjorness &amp; Greene, <em>Sleep Medicine Reviews</em>, 2009 : la caféine a une demi-vie
            de ~6 h. Un café à 16 h pèse encore sur ton sommeil à 22 h, et le sommeil finance la
            clarté de tes décisions. Le timing compte autant que la quantité.
          </p>
        </header>

        {prefill ? <AlreadyLoggedNotice pillarLabel="Café" /> : null}

        <CaffeineHabitWizard {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
