import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingSessionForm } from '@/components/training/training-session-form';

export const metadata = {
  title: 'Nouvelle session · Entraînement',
};

export const dynamic = 'force-dynamic';

export default async function NewTrainingSessionPage() {
  const session = await auth();
  // Defense-in-depth, symmetric with `createTrainingSessionAction`'s own gate.
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <TrainingSessionForm />
    </main>
  );
}
