import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CloseTradeForm } from '@/components/journal/close-trade-form';
import { getTradeById } from '@/lib/trades/service';

export const metadata = {
  title: 'Clôturer le trade',
};

export const dynamic = 'force-dynamic';

interface CloseTradePageProps {
  params: Promise<{ id: string }>;
}

function defaultExitedAt(enteredAtIso: string): string {
  const entered = new Date(enteredAtIso);
  // Default to now if the entry is older than now, else +1h.
  const proposed = new Date(Math.max(Date.now(), entered.getTime() + 60 * 60 * 1000));
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${proposed.getFullYear()}-${pad(proposed.getMonth() + 1)}-${pad(proposed.getDate())}T${pad(proposed.getHours())}:${pad(proposed.getMinutes())}`;
}

export default async function CloseTradePage({ params }: CloseTradePageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;
  const trade = await getTradeById(session.user.id, id);
  if (!trade) notFound();
  if (trade.isClosed) redirect(`/journal/${trade.id}`);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Link
          href={`/journal/${trade.id}`}
          className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Détail du trade
        </Link>
        <div className="flex flex-col gap-1">
          <p className="text-muted text-xs uppercase tracking-widest">Clôture</p>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
            Clôturer le trade <span className="font-mono">{trade.pair}</span>
          </h1>
          <p className="text-muted text-sm">
            Renseigne le prix de sortie, le résultat et la capture après sortie.
          </p>
        </div>
      </header>

      <CloseTradeForm tradeId={trade.id} defaultExitedAt={defaultExitedAt(trade.enteredAt)} />
    </main>
  );
}
