import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MorningCheckinWizard } from '@/components/checkin/morning-checkin-wizard';
import { todayFor } from '@/lib/checkin/service';

export const metadata = {
  title: 'Check-in matin · Fxmily',
};

export const dynamic = 'force-dynamic';

export default async function MorningCheckinPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const timezone = 'Europe/Paris'; // TODO J5.5: read from session.user.timezone
  const today = todayFor(timezone);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:py-10">
      <MorningCheckinWizard today={today} />
    </main>
  );
}
