import { ArrowLeft, ArrowRight, GraduationCap, Layers, NotebookPen, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TrainingSessionCard } from '@/components/training/training-session-card';
import { TrainingEquityCard, TrainingStatsBar } from '@/components/training/training-stats-bar';
import { TrainingTradeCardLinkable } from '@/components/training/training-trade-card-linkable';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { countUnseenTrainingAnnotationsByTrainingTrade } from '@/lib/training/training-annotation-member-service';
import { listTrainingSessionsForUser } from '@/lib/training/training-session-service';
import {
  getTrainingTradeStatsForUser,
  listTrainingTradesForUser,
} from '@/lib/training/training-trade-service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Entraînement',
};

export const dynamic = 'force-dynamic';

interface TrainingPageProps {
  searchParams: Promise<{ cursor?: string }>;
}

/** Backtest ids are cuids — a forged `?cursor=` must degrade to page 1, never
 * to a 500 (mirror `/journal` `parseCursor`). */
function parseTrainingCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

function trainingHref(cursor?: string): string {
  return cursor ? `/training?cursor=${cursor}` : '/training';
}

export default async function TrainingPage({ searchParams }: TrainingPageProps) {
  const session = await auth();
  // Defense-in-depth, mirroring the modern member-wizard canon (track/review):
  // the status gate is also enforced by `proxy.ts`, but the page must not be
  // weaker than its own Server Action (`createTrainingTradeAction`).
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { cursor: rawCursor } = await searchParams;
  const cursor = parseTrainingCursor(rawCursor);

  // A well-formed cursor can still fail the query (e.g. the backtest was
  // deleted) — degrade to page 1 instead of a 500. The net exists ONLY when a
  // cursor is in play, so a real DB outage on page 1 still surfaces the error
  // boundary rather than looping (mirror `/journal`). The redirect throws
  // outside the catch.
  let page: Awaited<ReturnType<typeof listTrainingTradesForUser>> | null = null;
  try {
    page = await listTrainingTradesForUser(session.user.id, { limit: 50, cursor });
  } catch (err) {
    if (!cursor) throw err;
    page = null;
  }
  if (page === null) redirect(trainingHref());

  const { items, nextCursor } = page;
  const [stats, unseenMap, sessions] = await Promise.all([
    getTrainingTradeStatsForUser(session.user.id),
    countUnseenTrainingAnnotationsByTrainingTrade(session.user.id),
    listTrainingSessionsForUser(session.user.id),
  ]);

  // §21.5-safe equity-curve input: the rows ALREADY rendered carry `enteredAt`
  // + `systemRespected` — derive the discipline curve from them, zero new query,
  // zero `resultR`/`outcome` read.
  const equityPoints = items.map((t) => ({
    enteredAt: t.enteredAt,
    systemRespected: t.systemRespected,
  }));

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient tone="cyan" />
      <div className="dash-stagger relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
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
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/training/sessions/new"
                className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}
              >
                <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
                Nouvelle session
              </Link>
              <Link
                href="/training/new"
                className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Nouveau backtest
              </Link>
            </div>
          </div>

          {/* Isolation banner — pedagogical (Mark Douglas) + honest: practice is
            separate from the real edge, by design. */}
          <p className="rounded-control border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
            Ton entraînement est <strong className="text-[var(--t-1)]">totalement isolé</strong> de
            ton trading réel : aucun résultat de backtest ne touche ton track-record, ton score ou
            tes statistiques. Ici, c&apos;est la régularité de la pratique qui compte — pas le
            P&amp;L.
          </p>

          {/* Entry point to the weekly training debrief (SPEC §23). The page is
            rich (timeline + crisis banner) but was otherwise only reachable by
            typing the URL — surface it here, on the training landing, without
            crowding the primary CTA row. */}
          <Link
            href="/training/debrief"
            className="rounded-control group flex items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-3 transition-colors hover:border-[var(--cy)] hover:bg-[var(--cy-dim)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
          >
            <span className="flex items-center gap-2.5">
              <NotebookPen className="h-4 w-4 shrink-0 text-[var(--cy)]" strokeWidth={1.75} />
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-[var(--t-1)]">
                  Débrief hebdo d&apos;entraînement
                </span>
                <span className="t-cap text-[var(--t-3)]">
                  Prends du recul sur ta semaine de pratique
                </span>
              </span>
            </span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-[var(--t-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--cy)]"
              strokeWidth={1.75}
            />
          </Link>
        </header>

        {/* Sessions de backtest — regroupent les backtests d'une même séance de
          replay (S8). Affichées seulement s'il en existe ; sinon le bouton
          "Nouvelle session" du header suffit (pas d'empty-state redondant). */}
        {sessions.length > 0 ? (
          <section aria-labelledby="training-sessions-heading" className="flex flex-col gap-3">
            <h2
              id="training-sessions-heading"
              className="t-h3 flex items-center gap-2 text-[var(--t-1)]"
            >
              <Layers className="h-4 w-4 text-[var(--cy)]" strokeWidth={1.75} />
              Séances de backtest
              <span className="t-cap text-[var(--t-4)] tabular-nums">({sessions.length})</span>
            </h2>
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/training/sessions/${s.id}`}
                    aria-label={`Ouvrir la session ${s.label?.trim() || 'sans nom'} (${s.tradeCount} backtest${s.tradeCount > 1 ? 's' : ''})`}
                    className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
                  >
                    <TrainingSessionCard session={s} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Tous les backtests (standalone + ceux des séances) */}
        {stats.total === 0 ? (
          <Card primary className="py-2">
            <EmptyState
              icon={GraduationCap}
              headline="Aucun backtest pour l'instant."
              lead="L'entraînement, c'est répéter le geste hors risque réel pour ancrer ton process."
              guides={[
                'Ouvre une session pour regrouper les backtests d’une même séance de replay.',
                'Capture ton analyse TradingView avant de noter le backtest.',
                'Note la leçon tirée — c’est elle qui fait progresser, pas le résultat.',
              ]}
              tip="Le résultat d'un backtest ne dit rien de ta valeur de trader. Ce qu'on mesure ici, c'est la discipline du process — anything can happen, ton geste reste propre."
            />
          </Card>
        ) : items.length === 0 ? (
          // Stale cursor — a backtest was deleted since this paginated link was
          // rendered. Calm dead-end (the member DOES have backtests, just none on
          // this page), never the onboarding copy.
          <Card primary className="py-2">
            <EmptyState
              icon={GraduationCap}
              headline="Plus rien à afficher ici."
              lead="Tu es arrivé au bout de ta liste de backtests."
              ctaPrimary="Revenir au début"
              ctaHref="/training"
            />
          </Card>
        ) : (
          <>
            {sessions.length > 0 ? (
              <h2 className="t-h3 flex items-center gap-2 text-[var(--t-1)]">
                <GraduationCap className="h-4 w-4 text-[var(--cy)]" strokeWidth={1.75} />
                Tous les backtests
              </h2>
            ) : null}
            <TrainingStatsBar stats={stats} />
            <TrainingEquityCard points={equityPoints} total={stats.total} />
            <ul className="flex flex-col gap-3">
              {items.map((trade) => (
                <li key={trade.id}>
                  <TrainingTradeCardLinkable
                    trade={trade}
                    href={`/training/${trade.id}`}
                    unseenAnnotationsCount={unseenMap.get(trade.id) ?? 0}
                  />
                </li>
              ))}
            </ul>
            <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
              {nextCursor ? (
                <Link
                  href={trainingHref(nextCursor)}
                  prefetch={false}
                  className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
                >
                  Voir les backtests plus anciens
                </Link>
              ) : null}
              <p className="t-foot text-center text-[var(--t-4)]">
                {items.length} backtest{items.length > 1 ? 's' : ''} affiché
                {items.length > 1 ? 's' : ''} sur {stats.total}
                {cursor ? (
                  <>
                    {' · '}
                    <Link href="/training" className="underline hover:text-[var(--t-2)]">
                      revenir au début
                    </Link>
                  </>
                ) : null}
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
