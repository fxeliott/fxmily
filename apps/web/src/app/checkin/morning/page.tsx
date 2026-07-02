import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MorningCheckinWizard } from '@/components/checkin/morning-checkin-wizard';
import { resolveBackfillDateParam, todayFor } from '@/lib/checkin/service';

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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:py-10">
      <MorningCheckinWizard today={today} {...(backfillDate ? { backfillDate } : {})} />
    </main>
  );
}
