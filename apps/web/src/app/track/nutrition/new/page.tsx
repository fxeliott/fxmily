import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Apple, ArrowLeft } from 'lucide-react';

import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AlreadyLoggedNotice } from '@/components/track/already-logged-notice';
import { NutritionHabitWizard } from '@/components/track/nutrition-habit-wizard';
import { localDateOf } from '@/lib/checkin/timezone';
import { listRecentHabitLogs } from '@/lib/habit/service';
import { findTodayHabitLog, nutritionPrefillFromLog } from '@/lib/habit/today-log';
import { auth } from '@/auth';

/**
 * V2.1.1 TRACK — Nutrition wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<NutritionHabitWizard>`
 * Client Component which handles the 2-step flow + Server Action submit.
 *
 * P3 fix — if nutrition is already logged for the member-timezone today, the
 * wizard starts PREFILLED and an "already logged" notice makes re-submit-updates
 * explicit (pattern carbone `/review/new` #463).
 */

export const dynamic = 'force-dynamic';

export default async function TrackNutritionNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = localDateOf(new Date(), timezone);
  const existing = findTodayHabitLog(
    await listRecentHabitLogs(session.user.id, 1),
    today,
    'nutrition',
  );
  const prefill = existing ? nutritionPrefillFromLog(existing) : null;

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
          <p className="t-eyebrow-lg text-[var(--acc)]">Pilier nutrition</p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="rounded-control grid h-12 w-12 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Apple className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h1
              className="f-display h-rise text-[24px] font-semibold tracking-[-0.03em] text-[var(--t-1)] sm:text-[28px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Logger ta nutrition
            </h1>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
            Des repas réguliers stabilisent ta glycémie : moins d&apos;à-coups d&apos;énergie, moins
            de décisions impulsives en session. On note le nombre de repas et la qualité ressentie,
            aucun comptage de calories.
          </p>
        </header>

        {prefill ? <AlreadyLoggedNotice pillarLabel="Nutrition" /> : null}

        <NutritionHabitWizard {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
