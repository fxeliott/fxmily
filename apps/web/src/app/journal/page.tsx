import { ArrowLeft, BookOpen, Plus, Target } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeCard } from '@/components/journal/trade-card';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { countUnseenAnnotationsByTrade } from '@/lib/annotations/member-service';
import { countTradesByStatus, listTradesForUser } from '@/lib/trades/service';
import type { TradeStatusFilter } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Journal de trading · Fxmily',
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

  const [{ items }, totals, unseenByTrade] = await Promise.all([
    listTradesForUser(session.user.id, { status, limit: 50 }),
    countTradesByStatus(session.user.id),
    // J4 — Map<tradeId, unseenAnnotationsCount> for the "Nouvelle correction"
    // pill. Trades with no unread annotations simply aren't keyed, so the
    // default 0 from `<TradeCard />` keeps the badge hidden.
    countUnseenAnnotationsByTrade(session.user.id),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">Journal</span>
            <h1
              className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mes trades
            </h1>
          </div>
          <Link href="/journal/new" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Nouveau trade
          </Link>
        </div>
      </header>

      {/* Filter pills + counter */}
      <nav
        aria-label="Filtres"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--b-default)] pb-3"
      >
        {(['all', 'open', 'closed'] as const).map((f) => {
          const active = status === f;
          const count =
            f === 'open'
              ? totals.open
              : f === 'closed'
                ? totals.closed
                : totals.open + totals.closed;
          return (
            <Link
              key={f}
              href={f === 'all' ? '/journal' : `/journal?status=${f}`}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-pill inline-flex h-9 items-center gap-1.5 border px-3 text-[12px] font-medium transition-colors',
                active
                  ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
                  : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:text-[var(--t-1)]',
              )}
            >
              {FILTER_LABEL[f]}
              <span
                className={cn(
                  'rounded-pill px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  active
                    ? 'bg-[var(--bg)] text-[var(--acc)]'
                    : 'bg-[var(--bg-2)] text-[var(--t-4)]',
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}

        <div className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--t-4)]">
          <span>{totals.open + totals.closed} cumulés</span>
        </div>
      </nav>

      {/* List or EmptyState */}
      {items.length === 0 ? (
        <Card primary className="py-2">
          {status === 'open' ? (
            <EmptyState
              icon={Target}
              headline="Aucun trade ouvert."
              lead="Les trades ouverts attendent leur clôture (prix sortie, outcome, capture)."
              guides={[
                "Les ordres en cours doivent être loggués au moment de l'entrée.",
                'À la sortie, ouvre /journal/[id]/close pour finaliser le R réalisé.',
                'Tu peux cumuler plusieurs trades ouverts simultanément.',
              ]}
              tip="Discipline : ne pas ouvrir un nouveau trade sans avoir clôturé proprement le précédent quand c'est possible."
              ctaPrimary={
                <>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Logger un trade
                </>
              }
            />
          ) : status === 'closed' ? (
            <EmptyState
              icon={BookOpen}
              headline="Aucun trade clôturé."
              lead="Tes trades clôturés apparaîtront ici avec leur R réalisé et leur plan score."
              guides={[
                'Logge un trade ouvert en passant par /journal/new.',
                'Au moment de la sortie, clôture-le avec le résultat.',
                'Le R réalisé est calculé automatiquement (computed) ou estimé (fallback).',
              ]}
              ctaPrimary={
                <>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Logger un trade
                </>
              }
            />
          ) : (
            <EmptyState
              icon={Target}
              headline="Ton journal est vide."
              lead="Tes 5 premiers trades calibrent ton baseline. À partir du 6e, on déverrouille les scores discipline et le R cumulé."
              guides={[
                "Logge ton plan AVANT d'entrer (R:R visé, lot, scénario, capture).",
                'Note ton R:R réel ET ta discipline post-clôture.',
                'Mental check J+1 — discipline + sérénité, pas le résultat.',
              ]}
              tip="Le marché peut faire ce qu'il veut. Toi, tu restes propre. C'est ça qu'on mesure ici — anything can happen, mais ton process reste."
              ctaPrimary={
                <>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Logger mon premier trade
                </>
              }
            />
          )}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((trade) => (
            <li key={trade.id}>
              <TradeCard trade={trade} unseenAnnotationsCount={unseenByTrade.get(trade.id) ?? 0} />
            </li>
          ))}
        </ul>
      )}

      {/* Footer ref count */}
      {items.length > 0 ? (
        <p className="t-foot border-t border-[var(--b-subtle)] pt-3 text-center text-[var(--t-4)]">
          Affichage de {items.length} trade{items.length > 1 ? 's' : ''} ·{' '}
          <span className="font-mono tabular-nums">limite 50 / page</span>
        </p>
      ) : null}
    </main>
  );
}
