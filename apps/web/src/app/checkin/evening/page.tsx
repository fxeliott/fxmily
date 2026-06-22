import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { EveningCheckinWizard } from '@/components/checkin/evening-checkin-wizard';
import { MorningIntentionRecall } from '@/components/checkin/morning-intention-recall';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { getCheckin, todayFor } from '@/lib/checkin/service';

export const metadata = {
  title: 'Check-in soir',
};

export const dynamic = 'force-dynamic';

export default async function EveningCheckinPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = todayFor(timezone);
  // S12 — recall this morning's intention at the head of the evening reflection
  // (day-loop close). Read-only echo, no verdict. Renders nothing if unset.
  const morning = await getCheckin(session.user.id, today, 'morning');

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* S19 — ambient depth (parité avec le check-in matin + ses pages sœurs).
          Décoratif, reduced-motion-safe. */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10">
        <MorningIntentionRecall intention={morning?.intention} context="evening" />
        <EveningCheckinWizard
          today={today}
          hasMorningIntention={Boolean(morning?.intention?.trim())}
        />
      </div>
    </main>
  );
}
