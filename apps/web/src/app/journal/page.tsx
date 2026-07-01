import { ArrowLeft, BookOpen, Plus, Target } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TradeCard } from '@/components/journal/trade-card';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { countUnseenAnnotationsByTrade } from '@/lib/annotations/member-service';
import { countTradesByStatus, listTradesForUser } from '@/lib/trades/service';
import type { TradeStatusFilter } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Journal de trading',
};

export const dynamic = 'force-dynamic';

interface JournalPageProps {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}

const FILTER_LABEL: Record<TradeStatusFilter, string> = {
  all: 'Tous',
  open: 'Ouverts',
  closed: 'Clôturés',
};

function parseFilter(value: string | undefined): TradeStatusFilter {
  return value === 'open' || value === 'closed' ? value : 'all';
}

/**
 * Trade ids are cuids — reject anything else BEFORE it reaches the Prisma
 * cursor (a forged `?cursor=` must degrade to page 1, never to a 500).
 */
function parseCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

function journalHref(status: TradeStatusFilter, cursor?: string): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/journal?${qs}` : '/journal';
}

export default async function JournalPage({ searchParams }: JournalPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { status: rawStatus, cursor: rawCursor } = await searchParams;
  const status = parseFilter(rawStatus);
  const cursor = parseCursor(rawCursor);

  // A well-formed cursor could still make the query fail — degrade to page 1
  // instead of surfacing a server error. The net exists ONLY when a cursor is
  // in play: catching every error would turn a DB outage into a /journal →
  // /journal redirect loop instead of the error boundary (S4 review finding).
  // The redirect stays OUTSIDE the catch — Next signals it by throwing.
  let page: Awaited<ReturnType<typeof listTradesForUser>> | null = null;
  try {
    page = await listTradesForUser(session.user.id, { status, limit: 50, cursor });
  } catch (err) {
    if (!cursor) throw err;
    page = null;
  }
  if (page === null) redirect(journalHref(status));

  const { items, nextCursor } = page;
  const [totals, unseenByTrade] = await Promise.all([
    countTradesByStatus(session.user.id),
    // J4 — Map<tradeId, unseenAnnotationsCount> for the "Nouvelle correction"
    // pill. Trades with no unread annotations simply aren't keyed, so the
    // default 0 from `<TradeCard />` keeps the badge hidden.
    countUnseenAnnotationsByTrade(session.user.id),
  ]);

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      {/* S11 — DS-v3 ambient mesh + drifting orbs depth backplate (same zero-JS
          server component the hub uses). Turns the most-visited surface from a
          flat black list into a living execution log, without a single new
          query. Decorative: aria-hidden + pointer-events:none + reduced-motion. */}
      <DashboardAmbient />

      {/* `dash-stagger` cascades the header / filters / list / footer in on load
          (wowRise, compositor-only, reduced-motion-safe) — the hub's "alive
          arrival" pattern, now on the journal too. */}
      <div className="dash-stagger relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
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
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
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
                  'rounded-pill inline-flex h-9 items-center gap-1.5 border px-3 text-[12px] font-medium transition-[color,border-color,transform] hover:-translate-y-px active:translate-y-0 active:scale-[0.98]',
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

          <div className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] text-[var(--t-4)] tabular-nums">
            {/* S19.2 — §11 : the "5 trades calibrate your baseline, the 6th
                unlocks scores" promise (empty-state) vanished after the 1st
                trade. Keep it visible as a calm segmented progress until the
                baseline is met, so the member always knows where they are. */}
            {totals.open + totals.closed >= 1 && totals.open + totals.closed < 6 ? (
              <BaselineProgress done={totals.open + totals.closed} />
            ) : (
              <span>{totals.open + totals.closed} cumulés</span>
            )}
          </div>
        </nav>

        {/* List or EmptyState */}
        {items.length === 0 && cursor ? (
          // Stale cursor (trade deleted since the link was rendered) — calm
          // dead-end, never the "first trade" onboarding copy.
          <Card primary className="py-2">
            <EmptyState
              icon={BookOpen}
              headline="Fin du journal."
              lead="Cette page ne contient plus de trades."
              ctaPrimary="Revenir au début"
              ctaHref={journalHref(status)}
            />
          </Card>
        ) : items.length === 0 ? (
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
                ctaHref="/journal/new"
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
                ctaHref="/journal/new"
              />
            ) : (
              <EmptyState
                icon={Target}
                headline="Ton journal est vide."
                lead="Tes 5 premiers trades calibrent ton baseline. À partir du 6e, on déverrouille les scores discipline et le R cumulé."
                guides={[
                  "Logge ton plan AVANT d'entrer (R:R visé, lot, scénario, capture).",
                  'Note ton R:R réel ET ta discipline post-clôture.',
                  'Mental check J+1 · discipline + sérénité, pas le résultat.',
                ]}
                tip="Le marché peut faire ce qu'il veut. Toi, tu restes propre. C'est ça qu'on mesure ici, anything can happen, mais ton process reste."
                ctaPrimary={
                  <>
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Logger mon premier trade
                  </>
                }
                ctaHref="/journal/new"
              />
            )}
          </Card>
        ) : (
          <ul className="grid items-start gap-3 xl:grid-cols-2">
            {items.map((trade) => (
              // `wow-reveal` — each trade fades+rises as it scrolls into view
              // (scroll-driven CSS, zero-JS, @supports-gated, reduced-motion-safe
              // → degrades to fully visible). Kept as a class (not a framer
              // wrapper) so the `main ul > li > a` structure the e2e relies on
              // stays intact (a wrapper div would break the direct-child path).
              <li key={trade.id} className="wow-reveal">
                <TradeCard
                  trade={trade}
                  unseenAnnotationsCount={unseenByTrade.get(trade.id) ?? 0}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Pagination + ref count */}
        {items.length > 0 ? (
          <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
            {nextCursor ? (
              <Link
                href={journalHref(status, nextCursor)}
                prefetch={false}
                className={cn(btnVariants({ kind: 'ghost', size: 'm' }), 'active:scale-[0.98]')}
              >
                Voir les trades plus anciens
              </Link>
            ) : null}
            <p className="t-foot text-center text-[var(--t-4)]">
              Affichage de {items.length} trade{items.length > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">50 par page</span>
              {cursor ? (
                <>
                  {' · '}
                  <Link href={journalHref(status)} className="underline hover:text-[var(--t-2)]">
                    revenir au début
                  </Link>
                </>
              ) : null}
            </p>
          </footer>
        ) : null}
      </div>
    </main>
  );
}

/** S19.2 — calm 5-segment baseline meter shown in the journal counter while the
 *  member is still calibrating (1–5 trades). Mirrors the empty-state promise so
 *  the "where am I" cue survives the first trade. The label carries the meaning;
 *  the segments are decorative (aria-hidden). Never a pressure cue. */
function BaselineProgress({ done }: { done: number }) {
  const filled = Math.min(done, 5);
  return (
    <span
      className="inline-flex items-center gap-2"
      title="Tes 5 premiers trades calibrent ton baseline ; le 6e déverrouille tes scores."
    >
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 w-3 rounded-full transition-colors',
              i < filled ? 'bg-[var(--acc)]' : 'bg-[var(--b-strong)]',
            )}
          />
        ))}
      </span>
      <span className="text-[var(--acc-hi)]">Baseline {filled}/5</span>
    </span>
  );
}
