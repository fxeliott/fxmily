import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingFormWizard } from '@/components/training/training-form-wizard';

export const metadata = {
  title: 'Nouveau backtest · Entraînement',
};

export const dynamic = 'force-dynamic';

export default async function NewTrainingTradePage() {
  const session = await auth();
  // Defense-in-depth, mirroring the modern member-wizard canon (track/review):
  // symmetric with `createTrainingTradeAction`'s own status gate.
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <TrainingFormWizard />
    </main>
  );
}
