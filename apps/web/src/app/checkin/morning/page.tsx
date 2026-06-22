import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MorningCheckinWizard } from '@/components/checkin/morning-checkin-wizard';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { todayFor } from '@/lib/checkin/service';

export const metadata = {
  title: 'Check-in matin',
};

export const dynamic = 'force-dynamic';

export default async function MorningCheckinPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const timezone = session.user.timezone || 'Europe/Paris';
  const today = todayFor(timezone);

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* S19 — ambient depth (parité avec les formulaires sœurs : track new, journal
          close. Le check-in matin était plat). Décoratif, reduced-motion-safe. */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10">
        <MorningCheckinWizard today={today} />
      </div>
    </main>
  );
}
