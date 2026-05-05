import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeFormWizard } from '@/components/journal/trade-form-wizard';

export const metadata = {
  title: 'Nouveau trade',
};

export const dynamic = 'force-dynamic';

export default async function NewTradePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <TradeFormWizard />
    </main>
  );
}
