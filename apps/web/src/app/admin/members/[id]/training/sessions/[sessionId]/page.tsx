import { ArrowLeft, GraduationCap, Layers } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { getMemberDetail, MemberNotFoundError } from '@/lib/admin/members-service';
import { getTrainingSessionWithTradesAsAdmin } from '@/lib/training/training-session-admin-service';

export const metadata = {
  title: 'Session de backtest · Fxmily Admin',
};

export const dynamic = 'force-dynamic';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface AdminTrainingSessionDetailPageProps {
  params: Promise<{ id: string; sessionId: string }>;
}

export default async function AdminTrainingSessionDetailPage({
  params,
}: AdminTrainingSessionDetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id: memberId, sessionId } = await params;

  let memberName: string;
  try {
    memberName = (await getMemberDetail(memberId)).displayName;
  } catch (err) {
    if (err instanceof MemberNotFoundError) notFound();
    throw err;
  }

  const tSession = await getTrainingSessionWithTradesAsAdmin(memberId, sessionId);
  if (!tSession) notFound();

  const title = tSession.label?.trim() || 'Session sans nom';
  const isEnded = tSession.endedAt != null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-8">
      <Link
        href={`/admin/members/${memberId}?tab=training`}
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Entraînement de {memberName}
      </Link>

      <header className="flex flex-col gap-2">
        <span className="t-eyebrow inline-flex w-fit items-center gap-1.5 text-[var(--cy)]">
          <Layers className="h-3.5 w-3.5" strokeWidth={2} />
          Session de backtest
        </span>
        <h1
          className="f-display text-[24px] leading-[1.1] font-bold tracking-[-0.02em] text-[var(--t-1)] sm:text-[28px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {tSession.symbol ? <Pill tone="mute">{tSession.symbol}</Pill> : null}
          {tSession.timeframe ? <Pill tone="mute">{tSession.timeframe}</Pill> : null}
          <Pill tone={isEnded ? 'mute' : 'cy'} dot={isEnded ? false : 'live'}>
            {isEnded ? 'Terminée' : 'En cours'}
          </Pill>
        </div>
        <p className="t-cap text-[var(--t-4)] tabular-nums">
          Ouverte le {DATE_FMT.format(new Date(tSession.startedAt))}
          {tSession.endedAt ? ` · terminée le ${DATE_FMT.format(new Date(tSession.endedAt))}` : ''}
        </p>
      </header>

      {tSession.notes ? (
        <Card className="flex flex-col gap-1.5 p-4">
          <h2 className="t-eyebrow-lg text-[var(--t-3)]">Notes de séance</h2>
          <p className="t-body whitespace-pre-wrap text-[var(--t-2)]">{tSession.notes}</p>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="t-h3 text-[var(--t-1)]">
          Backtests{' '}
          <span className="t-cap text-[var(--t-4)] tabular-nums">({tSession.tradeCount})</span>
        </h2>

        {tSession.trades.length === 0 ? (
          <Card primary className="py-2">
            <EmptyState
              icon={GraduationCap}
              headline="Aucun backtest dans cette séance."
              lead="Le membre n'a encore journalisé aucun backtest dans cette session."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {tSession.trades.map((trade) => (
              <li key={trade.id}>
                <Link
                  href={`/admin/members/${memberId}/training/${trade.id}`}
                  aria-label={`Corriger le backtest ${trade.pair}`}
                  className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
                >
                  <TrainingTradeCard trade={trade} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
