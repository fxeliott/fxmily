import { ArrowLeft, GraduationCap, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingStatsBar } from '@/components/training/training-stats-bar';
import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { listTrainingTradesForUser } from '@/lib/training/training-trade-service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Entraînement · Fxmily',
};

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const session = await auth();
  // Defense-in-depth, mirroring the modern member-wizard canon (track/review):
  // the status gate is also enforced by `proxy.ts`, but the page must not be
  // weaker than its own Server Action (`createTrainingTradeAction`).
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const trades = await listTrainingTradesForUser(session.user.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      {/* Header — MODE ENTRAÎNEMENT identity, non-confusable with the live journal */}
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
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
              Mode entraînement
            </span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mes backtests
            </h1>
          </div>
          <Link href="/training/new" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Nouveau backtest
          </Link>
        </div>

        {/* Isolation banner — pedagogical (Mark Douglas) + honest: practice is
            separate from the real edge, by design. */}
        <p className="rounded-control border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
          Ton entraînement est <strong className="text-[var(--t-1)]">totalement isolé</strong> de
          ton trading réel : aucun résultat de backtest ne touche ton track-record, ton score ou tes
          statistiques. Ici, c&apos;est la régularité de la pratique qui compte — pas le P&amp;L.
        </p>
      </header>

      {trades.length === 0 ? (
        <Card primary className="py-2">
          <EmptyState
            icon={GraduationCap}
            headline="Aucun backtest pour l'instant."
            lead="L'entraînement, c'est répéter le geste hors risque réel pour ancrer ton process."
            guides={[
              'Capture ton analyse TradingView avant de noter le backtest.',
              'Renseigne ton R:R prévu et si tu as respecté ton système.',
              'Note la leçon tirée — c’est elle qui fait progresser, pas le résultat.',
            ]}
            tip="Le résultat d'un backtest ne dit rien de ta valeur de trader. Ce qu'on mesure ici, c'est la discipline du process — anything can happen, ton geste reste propre."
          />
        </Card>
      ) : (
        <>
          <TrainingStatsBar trades={trades} />
          <ul className="flex flex-col gap-3">
            {trades.map((trade) => (
              <li key={trade.id}>
                <TrainingTradeCard trade={trade} />
              </li>
            ))}
          </ul>
          <p className="t-foot border-t border-[var(--b-subtle)] pt-3 text-center text-[var(--t-4)]">
            {trades.length} backtest{trades.length > 1 ? 's' : ''} enregistré
            {trades.length > 1 ? 's' : ''}
          </p>
        </>
      )}
    </main>
  );
}
