import { ArrowLeft, ArrowRight, GraduationCap, Layers, NotebookPen, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TrainingSessionCard } from '@/components/training/training-session-card';
import {
  TrainingEquityCard,
  TrainingRegularityBar,
  TrainingStatsBar,
} from '@/components/training/training-stats-bar';
import { TrainingTradeCardLinkable } from '@/components/training/training-trade-card-linkable';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import type { TrainingOutcome } from '@/generated/prisma/enums';
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
  searchParams: Promise<{ outcome?: string; cursor?: string }>;
}

/** §255 result filter (brief "journal filtrable"). Labels stay strictly
 * descriptive (result only), never a market judgement (garde-fou §2). */
const OUTCOME_FILTERS = [
  { v: 'all', label: 'Tous' },
  { v: 'win', label: 'Gagnants' },
  { v: 'loss', label: 'Perdants' },
  { v: 'break_even', label: 'Break-even' },
] as const;

const OUTCOME_FILTER_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOME_FILTERS.map((f) => [f.v, f.label]),
);

/** Backtest ids are cuids — a forged `?cursor=` must degrade to page 1, never
 * to a 500 (mirror `/journal` `parseCursor`). */
function parseTrainingCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

/** Whitelist the result filter — anything else (forged / typo) degrades to
 * "Tous" (undefined), never a 500 (mirror `/journal` `parseFilter`). */
function parseTrainingOutcome(value: string | undefined): TrainingOutcome | undefined {
  return value === 'win' || value === 'loss' || value === 'break_even' ? value : undefined;
}

/** Build a `/training` href preserving the active filter across pagination
 * (mirror `/journal` `journalHref`). `outcome === undefined` = "Tous". */
function trainingHref(outcome: TrainingOutcome | undefined, cursor?: string): string {
  const params = new URLSearchParams();
  if (outcome) params.set('outcome', outcome);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/training?${qs}` : '/training';
}

export default async function TrainingPage({ searchParams }: TrainingPageProps) {
  const session = await auth();
  // Defense-in-depth, mirroring the modern member-wizard canon (track/review):
  // the status gate is also enforced by `proxy.ts`, but the page must not be
  // weaker than its own Server Action (`createTrainingTradeAction`).
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const timezone = session.user.timezone || 'Europe/Paris';

  const { outcome: rawOutcome, cursor: rawCursor } = await searchParams;
  const outcome = parseTrainingOutcome(rawOutcome);
  const cursor = parseTrainingCursor(rawCursor);

  // A well-formed cursor can still fail the query (e.g. the backtest was
  // deleted) — degrade to page 1 instead of a 500. The net exists ONLY when a
  // cursor is in play, so a real DB outage on page 1 still surfaces the error
  // boundary rather than looping (mirror `/journal`). The redirect throws
  // outside the catch.
  let page: Awaited<ReturnType<typeof listTrainingTradesForUser>> | null = null;
  try {
    page = await listTrainingTradesForUser(session.user.id, { limit: 50, cursor, outcome });
  } catch (err) {
    if (!cursor) throw err;
    page = null;
  }
  if (page === null) redirect(trainingHref(outcome));

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

  // Full-history denominator for the footer "X sur N" — the active filter's own
  // total (stats are full-history, so the filtered count is exact), not the
  // grand total, so the footer stays honest under a filter.
  const filteredTotal =
    outcome === 'win'
      ? stats.winCount
      : outcome === 'loss'
        ? stats.lossCount
        : outcome === 'break_even'
          ? stats.breakEvenCount
          : stats.total;

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
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </Link>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
                <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
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
                <Layers className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                Nouvelle session
              </Link>
              <Link
                href="/training/new"
                className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                Nouveau backtest
              </Link>
            </div>
          </div>

          {/* Isolation banner — pedagogical (Mark Douglas) + honest: practice is
            separate from the real edge, by design. */}
          <p className="rounded-control border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
            Ton entraînement est <strong className="text-[var(--t-1)]">totalement isolé</strong> de
            ton trading réel : aucun résultat de backtest ne touche ton track-record, ton score ou
            tes statistiques. Ici, c&apos;est la régularité de la pratique qui compte, pas le
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
              <NotebookPen
                className="h-4 w-4 shrink-0 text-[var(--cy)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
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
              aria-hidden="true"
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
              <Layers className="h-4 w-4 text-[var(--cy)]" strokeWidth={1.75} aria-hidden="true" />
              Séances de backtest
              <span className="t-cap text-[var(--t-4)] tabular-nums">({sessions.length})</span>
            </h2>
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => (
                <li key={s.id}>
                  {/* Cyan training identity (§21.7) : lift spring + halo cyan au
                      survol, comme TrainingTradeCardLinkable — remplace le
                      `hover:opacity-90` plat (HoverGlowLift gère reduced-motion +
                      forced-colors). */}
                  <HoverGlowLift tone="cy" className="rounded-card block">
                    <Link
                      href={`/training/sessions/${s.id}`}
                      aria-label={`Ouvrir la session ${s.label?.trim() || 'sans nom'} (${s.tradeCount} backtest${s.tradeCount > 1 ? 's' : ''})`}
                      className="rounded-card block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
                    >
                      <TrainingSessionCard session={s} timezone={timezone} />
                    </Link>
                  </HoverGlowLift>
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
                'Note la leçon tirée, c’est elle qui fait progresser, pas le résultat.',
              ]}
              tip="Le résultat d'un backtest ne dit rien de ta valeur de trader. Ce qu'on mesure ici, c'est la discipline du process. Anything can happen, ton geste reste propre."
            />
          </Card>
        ) : (
          <>
            {sessions.length > 0 ? (
              <h2 className="t-h3 flex items-center gap-2 text-[var(--t-1)]">
                <GraduationCap
                  className="h-4 w-4 text-[var(--cy)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                Tous les backtests
              </h2>
            ) : null}
            <TrainingStatsBar stats={stats} />
            <TrainingRegularityBar stats={stats} sessionCount={sessions.length} />

            {/* §255 — journal FILTRABLE par résultat. Miroir des pills /journal ;
              §21.5-safe (db.trainingTrade only) + libellés strictement descriptifs
              (résultat), jamais d'analyse de marché (garde-fou §2). */}
            <nav
              aria-label="Filtres"
              className="flex flex-wrap items-center gap-2 border-b border-[var(--b-default)] pb-3"
            >
              {OUTCOME_FILTERS.map((f) => {
                const active = (outcome ?? 'all') === f.v;
                const count =
                  f.v === 'win'
                    ? stats.winCount
                    : f.v === 'loss'
                      ? stats.lossCount
                      : f.v === 'break_even'
                        ? stats.breakEvenCount
                        : stats.total;
                return (
                  <Link
                    key={f.v}
                    href={trainingHref(f.v === 'all' ? undefined : (f.v as TrainingOutcome))}
                    prefetch={false}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-pill inline-flex h-9 items-center gap-1.5 border px-3 text-[12px] font-medium transition-[color,border-color,transform] active:translate-y-0 active:scale-[0.98] motion-safe:hover:-translate-y-px',
                      active
                        ? 'border-[var(--cy-edge)] bg-[var(--cy-dim)] text-[var(--cy)]'
                        : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:text-[var(--t-1)]',
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        'rounded-pill px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                        active
                          ? 'bg-[var(--bg)] text-[var(--cy)]'
                          : 'bg-[var(--bg-2)] text-[var(--t-4)]',
                      )}
                    >
                      {count}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {items.length === 0 ? (
              <Card primary className="py-2">
                {outcome ? (
                  // Filtre actif sans correspondance — dead-end calme, jamais
                  // l'onboarding (le membre A des backtests, juste aucun de ce
                  // résultat).
                  <EmptyState
                    icon={GraduationCap}
                    headline={`Aucun backtest « ${OUTCOME_FILTER_LABEL[outcome]} ».`}
                    lead="Aucun backtest ne correspond à ce filtre pour l'instant."
                    ctaPrimary="Voir tous les backtests"
                    ctaHref="/training"
                  />
                ) : (
                  // Stale cursor — a backtest was deleted since this paginated
                  // link was rendered. Calm dead-end, never the onboarding copy.
                  <EmptyState
                    icon={GraduationCap}
                    headline="Plus rien à afficher ici."
                    lead="Tu es arrivé au bout de ta liste de backtests."
                    ctaPrimary="Revenir au début"
                    ctaHref="/training"
                  />
                )}
              </Card>
            ) : (
              <>
                <TrainingEquityCard points={equityPoints} total={stats.total} timezone={timezone} />
                <ul className="flex flex-col gap-3">
                  {items.map((trade) => (
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
                <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
                  {nextCursor ? (
                    <Link
                      href={trainingHref(outcome, nextCursor)}
                      prefetch={false}
                      className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
                    >
                      Voir les backtests plus anciens
                    </Link>
                  ) : null}
                  <p className="t-foot text-center text-[var(--t-4)]">
                    {items.length} backtest{items.length > 1 ? 's' : ''} affiché
                    {items.length > 1 ? 's' : ''} sur {filteredTotal}
                    {cursor ? (
                      <>
                        {' · '}
                        <Link
                          href={trainingHref(outcome)}
                          className="underline hover:text-[var(--t-2)]"
                        >
                          revenir au début
                        </Link>
                      </>
                    ) : null}
                  </p>
                </footer>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
