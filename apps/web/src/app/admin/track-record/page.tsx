import { Database, LineChart, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PublicTradeRow } from '@/components/admin/track-record/public-trade-row';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import {
  getCatalogStats,
  listPublicTrades,
  type PublicTradeListFilters,
} from '@/lib/admin/public-trade-service';
import { PUBLIC_TRADE_SEGMENTS, PUBLIC_TRADE_STATUSES } from '@/lib/schemas/public-trade';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const VALID_SEGMENTS = new Set<string>(PUBLIC_TRADE_SEGMENTS);
const VALID_STATUSES = new Set<string>(PUBLIC_TRADE_STATUSES);

interface AdminTrackRecordPageProps {
  searchParams: Promise<{
    segment?: string;
    status?: string;
    instrument?: string;
    published?: string;
  }>;
}

/**
 * `/admin/track-record` — list + filters + stats strip.
 *
 * Server Component carbone J7 `/admin/cards/page.tsx`. Auth gate explicite
 * (role admin + status active). Filters URL searchParams pour bookmarkability +
 * shareable links.
 */
export default async function AdminTrackRecordPage({ searchParams }: AdminTrackRecordPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login');
  }

  const params = await searchParams;

  const filters: PublicTradeListFilters = {
    ...(typeof params.segment === 'string' && VALID_SEGMENTS.has(params.segment)
      ? { segment: params.segment as PublicTradeListFilters['segment'] }
      : {}),
    ...(typeof params.status === 'string' && VALID_STATUSES.has(params.status)
      ? { status: params.status as PublicTradeListFilters['status'] }
      : {}),
    ...(typeof params.instrument === 'string' && params.instrument.length > 0
      ? { instrument: params.instrument.slice(0, 32).toUpperCase() }
      : {}),
    ...(params.published === 'true'
      ? { published: true }
      : params.published === 'false'
        ? { published: false }
        : {}),
  };

  const [trades, stats] = await Promise.all([listPublicTrades(filters), getCatalogStats()]);

  return (
    <main className="container mx-auto max-w-6xl px-4 pt-6 pb-24 md:pt-10">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--acc-dim)] text-[var(--acc)]">
            <LineChart className="h-4 w-4" aria-hidden strokeWidth={1.75} />
          </span>
          <Pill tone="acc">Admin</Pill>
          <Pill tone="mute">T5</Pill>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Track Record public</h1>
          <Link
            href="/admin/track-record/new"
            className={cn(btnVariants({ kind: 'primary', size: 'm' }), 'gap-1.5')}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
            Nouveau trade
          </Link>
        </div>
        <p className="text-sm text-[var(--t-3)]">
          Gestion CRUD des trades publics d&apos;Eliott (segments <em>historique</em> +{' '}
          <em>live</em>). Les modifications se reflètent sur{' '}
          <code className="font-mono text-[12px]">trackrecordfxmily.pages.dev</code> après rebuild
          Cloudflare Pages (T6).
        </p>
      </header>

      {/* Stats strip 4 cells */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Historique" value={stats.historical} />
        <StatCard label="Live" value={stats.live} tone="acc" />
        <StatCard label="Brouillons" value={stats.drafts} tone="warn" />
      </div>

      {/* Filter strip */}
      <nav aria-label="Filtres" className="mb-5 flex flex-wrap gap-2">
        <FilterChip href="/admin/track-record" label="Tous" active={isAllFilter(params)} />
        <FilterChip
          href="/admin/track-record?segment=historical"
          label={`Historique (${stats.historical})`}
          active={params.segment === 'historical'}
        />
        <FilterChip
          href="/admin/track-record?segment=live"
          label={`Live (${stats.live})`}
          active={params.segment === 'live'}
        />
        <span aria-hidden className="mx-1 text-[var(--t-4)]">
          ·
        </span>
        <FilterChip
          href="/admin/track-record?status=open"
          label={`Ouverts (${stats.open})`}
          active={params.status === 'open'}
        />
        <FilterChip
          href="/admin/track-record?status=closed"
          label={`Clôturés (${stats.closed})`}
          active={params.status === 'closed'}
        />
        <FilterChip
          href="/admin/track-record?status=break_even"
          label={`BE (${stats.breakEven})`}
          active={params.status === 'break_even'}
        />
        <span aria-hidden className="mx-1 text-[var(--t-4)]">
          ·
        </span>
        <FilterChip
          href="/admin/track-record?published=false"
          label={`Brouillons (${stats.drafts})`}
          active={params.published === 'false'}
        />
      </nav>

      {trades.length === 0 ? (
        <Card className="p-6" edge={false}>
          <EmptyState
            icon={Database}
            headline="Aucun trade ne correspond"
            lead={
              isAllFilter(params)
                ? 'Lance le seed historique 2025 pour ingérer les 139 premiers trades.'
                : 'Essaie un autre filtre, ou crée un nouveau trade.'
            }
            tip={
              isAllFilter(params) ? (
                <>
                  Import script :{' '}
                  <code className="mx-1 rounded bg-[var(--bg-2)] px-1 py-0.5 font-mono text-[11px]">
                    pnpm exec tsx scripts/import-fxmily-trades.ts --year 2025
                  </code>
                </>
              ) : (
                <>
                  Les{' '}
                  <Link href="/admin/track-record" className="text-[var(--acc)] underline">
                    filtres au-dessus
                  </Link>{' '}
                  permettent de revoir tous les trades.
                </>
              )
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {trades.map((trade) => (
            <li key={trade.id}>
              <PublicTradeRow trade={trade} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// =============================================================================
// Stat card + filter chip
// =============================================================================

interface StatCardProps {
  label: string;
  value: number;
  tone?: 'acc' | 'warn' | undefined;
}

function StatCard({ label, value, tone }: StatCardProps) {
  return (
    <Card className="p-4" edge={false}>
      <p className="t-eyebrow-lg text-[var(--t-3)]">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'acc' && 'text-[var(--acc)]',
          tone === 'warn' && 'text-[var(--warn)]',
        )}
      >
        {value}
      </p>
    </Card>
  );
}

interface FilterChipProps {
  href: string;
  label: string;
  active: boolean;
}

function FilterChip({ href, label, active }: FilterChipProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-pill inline-flex h-9 items-center border px-3 text-xs font-medium transition-all',
        active
          ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
          : 'border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
      )}
    >
      {label}
    </Link>
  );
}

function isAllFilter(params: {
  segment?: string;
  status?: string;
  instrument?: string;
  published?: string;
}): boolean {
  return !params.segment && !params.status && !params.instrument && !params.published;
}
