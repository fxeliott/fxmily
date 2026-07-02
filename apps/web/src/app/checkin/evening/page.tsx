import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { EveningCheckinWizard } from '@/components/checkin/evening-checkin-wizard';
import { MorningIntentionRecall } from '@/components/checkin/morning-intention-recall';
import { getCheckin, resolveBackfillDateParam, todayFor } from '@/lib/checkin/service';

export const metadata = {
  title: 'Check-in soir',
};

export const dynamic = 'force-dynamic';

interface EveningCheckinPageProps {
  // F7 — `?date=YYYY-MM-DD` opens the wizard in rattrapage (backfill) mode for a
  // past local day. Validated server-side; anything invalid falls back to today.
  searchParams: Promise<{ date?: string }>;
}

export default async function EveningCheckinPage({ searchParams }: EveningCheckinPageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = todayFor(timezone);
  const { date } = await searchParams;
  const backfillDate = resolveBackfillDateParam(date, timezone);
  // On a rattrapage, recall the intention set on THAT day's morning (not today).
  const effectiveDate = backfillDate ?? today;
  // S12 — recall this morning's intention at the head of the evening reflection
  // (day-loop close). Read-only echo, no verdict. Renders nothing if unset.
  const morning = await getCheckin(session.user.id, effectiveDate, 'morning');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:py-10">
      <MorningIntentionRecall intention={morning?.intention} context="evening" />
      <EveningCheckinWizard
        today={today}
        {...(backfillDate ? { backfillDate } : {})}
        hasMorningIntention={Boolean(morning?.intention?.trim())}
      />
    </main>
  );
}
