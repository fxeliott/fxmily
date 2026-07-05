import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CheckinResumeNotice } from '@/components/checkin/checkin-resume-notice';
import { MorningCheckinWizard } from '@/components/checkin/morning-checkin-wizard';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { getCheckin, resolveBackfillDateParam, todayFor } from '@/lib/checkin/service';
import { toMorningPrefill } from '@/lib/checkin/prefill';

export const metadata = {
  title: 'Check-in matin',
};

export const dynamic = 'force-dynamic';

interface MorningCheckinPageProps {
  // F7 — `?date=YYYY-MM-DD` opens the wizard in rattrapage (backfill) mode for a
  // past local day. Validated server-side; anything invalid falls back to today.
  searchParams: Promise<{ date?: string }>;
}

export default async function MorningCheckinPage({ searchParams }: MorningCheckinPageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = todayFor(timezone);
  const { date } = await searchParams;
  const backfillDate = resolveBackfillDateParam(date, timezone);

  // P3 (#463 parity) — if TODAY already has a submitted morning check-in, seed
  // the wizard with it (edit mode) instead of opening empty. The service upsert
  // then becomes an EXPLICIT update, never a silent overwrite of answers the
  // member could not see. Scoped to the normal (non-backfill) flow: rattrapage
  // (F7) keeps its distinct fresh-draft + justification semantics untouched, and
  // never reads the today draft (the #1 F7 pitfall).
  const existing = backfillDate ? null : await getCheckin(session.user.id, today, 'morning');
  const prefill = existing ? toMorningPrefill(existing) : undefined;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* Tour 13 — ambiance de marque calme derrière le wizard (le membre AGIT
          ici chaque matin ; la surface ne doit plus être un aplat plat). */}
      <DashboardAmbient />
      <div className="page-stagger relative mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:py-10">
        {prefill ? <CheckinResumeNotice slot="morning" /> : null}
        <MorningCheckinWizard
          today={today}
          {...(backfillDate ? { backfillDate } : {})}
          {...(prefill ? { prefill } : {})}
        />
      </div>
    </main>
  );
}
