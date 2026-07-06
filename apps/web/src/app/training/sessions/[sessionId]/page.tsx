import { ArrowLeft, GraduationCap, Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { EndTrainingSessionButton } from '@/components/training/end-training-session-button';
import { TrainingTradeCardLinkable } from '@/components/training/training-trade-card-linkable';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { safeTimeZone } from '@/lib/checkin/timezone';
import { countUnseenTrainingAnnotationsByTrainingTrade } from '@/lib/training/training-annotation-member-service';
import { getTrainingSessionWithTradesById } from '@/lib/training/training-session-service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Session de backtest · Entraînement',
};

export const dynamic = 'force-dynamic';

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface MemberTrainingSessionDetailPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function MemberTrainingSessionDetailPage({
  params,
}: MemberTrainingSessionDetailPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const timezone = safeTimeZone(session.user.timezone);

  const { sessionId } = await params;

  const tSession = await getTrainingSessionWithTradesById(sessionId, session.user.id);
  if (!tSession) notFound();

  const unseenMap = await countUnseenTrainingAnnotationsByTrainingTrade(session.user.id);

  const title = tSession.label?.trim() || 'Session sans nom';
  const isEnded = tSession.endedAt != null;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient tone="cyan" />
      <div className="page-stagger relative mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/training"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Mode entraînement
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
                <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
                Session de backtest
              </span>
              <h1
                className="f-display h-rise text-[24px] leading-[1.1] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[28px]"
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
            </div>

            {!isEnded ? (
              <Link
                href={`/training/new?sessionId=${tSession.id}`}
                className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Ajouter un backtest
              </Link>
            ) : null}
          </div>

          <p className="t-cap text-[var(--t-4)] tabular-nums">
            Ouverte le {formatDate(new Date(tSession.startedAt), timezone)}
            {tSession.endedAt
              ? ` · terminée le ${formatDate(new Date(tSession.endedAt), timezone)}`
              : ''}
          </p>
        </header>

        {tSession.notes ? (
          <Card className="flex flex-col gap-1.5 p-4">
            <h2 className="t-eyebrow-lg text-[var(--t-3)]">Notes de séance</h2>
            <p className="t-body whitespace-pre-wrap text-[var(--t-2)]">{tSession.notes}</p>
          </Card>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="t-h3 text-[var(--t-1)]">
              Backtests{' '}
              <span className="t-cap text-[var(--t-4)] tabular-nums">({tSession.tradeCount})</span>
            </h2>
          </div>

          {tSession.trades.length === 0 ? (
            <Card primary className="py-2">
              <EmptyState
                icon={GraduationCap}
                headline="Aucun backtest dans cette séance."
                lead="Ajoute ton premier backtest pour commencer à journaliser ta pratique."
                {...(isEnded
                  ? {}
                  : {
                      ctaPrimary: 'Ajouter un backtest',
                      ctaHref: `/training/new?sessionId=${tSession.id}`,
                    })}
              />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {tSession.trades.map((trade) => (
                <li key={trade.id}>
                  <TrainingTradeCardLinkable
                    trade={trade}
                    href={`/training/${trade.id}`}
                    unseenAnnotationsCount={unseenMap.get(trade.id) ?? 0}
                    timezone={timezone}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {!isEnded ? (
          <div className="flex justify-end border-t border-[var(--b-subtle)] pt-4">
            <EndTrainingSessionButton sessionId={tSession.id} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
