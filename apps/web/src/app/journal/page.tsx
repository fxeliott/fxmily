import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeCard } from '@/components/journal/trade-card';
import { countTradesByStatus, listTradesForUser } from '@/lib/trades/service';
import type { TradeStatusFilter } from '@/lib/trades/service';

export const metadata = {
  title: 'Journal de trading',
};

export const dynamic = 'force-dynamic';

interface JournalPageProps {
  searchParams: Promise<{ status?: string }>;
}

const FILTER_LABEL: Record<TradeStatusFilter, string> = {
  all: 'Tous',
  open: 'Ouverts',
  closed: 'Clôturés',
};

function parseFilter(value: string | undefined): TradeStatusFilter {
  return value === 'open' || value === 'closed' ? value : 'all';
}

export default async function JournalPage({ searchParams }: JournalPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { status: rawStatus } = await searchParams;
  const status = parseFilter(rawStatus);

  const [{ items }, totals] = await Promise.all([
    listTradesForUser(session.user.id, { status, limit: 50 }),
    countTradesByStatus(session.user.id),
  ]);

  const totalOpen = totals.open;
  const totalClosed = totals.closed;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Tableau de bord
        </Link>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-muted text-xs uppercase tracking-widest">Journal</p>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
              Mes trades
            </h1>
          </div>
          <Link
            href="/journal/new"
            className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            + Nouveau trade
          </Link>
        </div>
      </header>

      <nav
        aria-label="Filtres"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3"
      >
        {(['all', 'open', 'closed'] as const).map((f) => {
          const active = status === f;
          return (
            <Link
              key={f}
              href={f === 'all' ? '/journal' : `/journal?status=${f}`}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={[
                'focus-visible:outline-accent inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                active
                  ? 'border-accent bg-accent/15 text-foreground font-semibold underline underline-offset-4'
                  : 'text-muted hover:text-foreground hover:border-accent border-[var(--border)] font-medium',
              ].join(' ')}
            >
              {FILTER_LABEL[f]}
            </Link>
          );
        })}
        <span className="text-muted ml-auto text-xs tabular-nums">
          {totalOpen} ouvert{totalOpen > 1 ? 's' : ''} · {totalClosed} clôturé
          {totalClosed > 1 ? 's' : ''}
        </span>
      </nav>

      {items.length === 0 ? (
        <EmptyState filter={status} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((trade) => (
            <li key={trade.id}>
              <TradeCard trade={trade} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState({ filter }: { filter: TradeStatusFilter }) {
  if (filter === 'open') {
    return (
      <div className="bg-card flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] px-6 py-10 text-center">
        <p className="text-foreground text-sm">Aucun trade ouvert.</p>
        <p className="text-muted text-xs">
          Les trades ouverts attendent leur clôture (prix sortie + résultat).
        </p>
      </div>
    );
  }
  if (filter === 'closed') {
    return (
      <div className="bg-card flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] px-6 py-10 text-center">
        <p className="text-foreground text-sm">Aucun trade clôturé pour l&apos;instant.</p>
      </div>
    );
  }
  return (
    <div className="bg-card flex flex-col items-center gap-4 rounded-lg border border-[var(--border)] px-6 py-12 text-center">
      <p className="text-foreground text-base font-medium">Ton journal est vide.</p>
      <p className="text-muted max-w-sm text-sm">
        Loggue ton premier trade pour commencer le suivi : capture avant entrée, plan, R:R prévu.
      </p>
      <Link
        href="/journal/new"
        className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Logger un trade
      </Link>
    </div>
  );
}
