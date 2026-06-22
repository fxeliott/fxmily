import { ArrowLeft, Plus, Search, Sparkles, Users, X } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberRow } from '@/components/admin/member-row';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { getMemberDirectoryStats, listMembersForAdmin } from '@/lib/admin/members-service';
import { logAudit } from '@/lib/auth/audit';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Membres · Admin',
};

export const dynamic = 'force-dynamic';

interface MembersPageProps {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}

/** Member ids are cuids — reject anything else BEFORE it reaches the Prisma
 *  cursor (a forged `?cursor=` must degrade to page 1, never to a 500). */
function parseCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

/** Trim + hard-cap the search term (anti-DoS on the Postgres ILIKE planner).
 *  Empty → undefined so the service skips the OR filter entirely. */
function parseQuery(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const q = value.trim().slice(0, 100);
  return q.length > 0 ? q : undefined;
}

/** Build the members href, carrying the active search + an optional cursor. */
function membersHref(query: string | undefined, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/admin/members?${qs}` : '/admin/members';
}

export default async function AdminMembersPage({ searchParams }: MembersPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { q: rawQuery, cursor: rawCursor } = await searchParams;
  const query = parseQuery(rawQuery);
  const cursor = parseCursor(rawCursor);

  // Cohort-wide stats (independent of search/page) + the current page in one
  // round of parallel reads. A stale cursor returns an empty page (handled by
  // the dead-end below); a genuine DB error must surface, not loop — the net
  // catches ONLY when a cursor is in play (mirror of the trades tab).
  let page: Awaited<ReturnType<typeof listMembersForAdmin>> | null = null;
  let stats: Awaited<ReturnType<typeof getMemberDirectoryStats>>;
  try {
    [stats, page] = await Promise.all([
      getMemberDirectoryStats(),
      listMembersForAdmin({ query, limit: 50, cursor }),
    ]);
  } catch (err) {
    if (!cursor) throw err;
    stats = await getMemberDirectoryStats();
    page = null;
  }
  if (page === null) redirect(membersHref(query));

  await logAudit({
    action: 'admin.members.listed',
    userId: session.user.id,
    metadata: { count: page.items.length, search: query ? 1 : 0 },
  });

  const isEmptyCohort = stats.total === 0;
  const isSearchMiss = !isEmptyCohort && page.items.length === 0;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[var(--w-app)] flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
      {/* S19.2 — ambient mesh for admin-surface coherence (cards/system/hub). */}
      <DashboardAmbient />
      <header className="relative flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Pill tone="acc">ADMIN</Pill>
              <span className="t-eyebrow">Cohorte privée</span>
            </div>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Membres
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/reports" className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              Rapports IA
            </Link>
            <Link href="/admin/invite" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Inviter un membre
            </Link>
          </div>
        </div>

        {/* Top stats strip — cohort-wide, unaffected by search/pagination. */}
        <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-4">
          <StatCell
            label="Total"
            value={stats.total}
            hint={stats.total > 0 ? 'membres' : 'aucun encore'}
          />
          <StatCell
            label="Actifs"
            value={stats.active}
            hint="connectés"
            tone={stats.active > 0 ? 'ok' : 'mute'}
          />
          <StatCell
            label="Suspendus"
            value={stats.suspended}
            hint={stats.suspended > 0 ? 'à revoir' : '—'}
            tone={stats.suspended > 0 ? 'bad' : 'mute'}
          />
          <StatCell
            label="Trades cumulés"
            value={stats.totalTrades}
            hint="tous membres"
            tone={stats.totalTrades > 0 ? 'acc' : 'mute'}
          />
        </div>

        {/* Search — server-rendered GET form (works without JS, accessible).
            Submitting drops any cursor → back to page 1 of the new query. */}
        {!isEmptyCohort ? (
          <form method="get" action="/admin/members" role="search" className="flex flex-col gap-2">
            <label htmlFor="member-search" className="sr-only">
              Rechercher un membre par nom ou email
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--t-4)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <input
                  id="member-search"
                  type="search"
                  name="q"
                  defaultValue={query ?? ''}
                  placeholder="Rechercher un membre (nom, email)…"
                  autoComplete="off"
                  maxLength={100}
                  className="rounded-card h-11 w-full border border-[var(--b-default)] bg-[var(--bg)] pr-3 pl-9 font-sans text-[14px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                />
              </div>
              <button type="submit" className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}>
                Rechercher
              </button>
              {query ? (
                <Link
                  href="/admin/members"
                  className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
                  aria-label="Effacer la recherche"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Effacer
                </Link>
              ) : null}
            </div>
            {query ? (
              <p className="t-cap text-[var(--t-3)]" role="status">
                Résultats pour «&nbsp;{query}&nbsp;»
              </p>
            ) : null}
          </form>
        ) : null}
      </header>

      {isEmptyCohort ? (
        <Card primary className="py-2">
          <EmptyState
            icon={Users}
            headline="Pas encore de membres."
            lead="La cohorte se construit à l'invitation. Chaque membre actif peut activer un trader qu'il connaît."
            guides={[
              'Vérifie que l’email du futur membre est correct.',
              'Le lien expire après 7 jours, il est unique et ne peut servir qu’une fois.',
              'Tu peux inviter à nouveau quelqu’un dont l’invitation a expiré.',
            ]}
            tip="Cohorte privée = qualité > quantité. Mieux vaut 30 traders sérieux que 300 curieux."
            ctaPrimary={
              <>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Envoyer la première invitation
              </>
            }
            ctaHref="/admin/invite"
          />
        </Card>
      ) : isSearchMiss ? (
        <div className="rounded-card flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-6 py-10 text-center">
          <p className="text-sm text-[var(--t-1)]">
            {cursor ? 'Fin de la liste.' : `Aucun membre ne correspond à « ${query} ».`}
          </p>
          <Link
            href={membersHref(cursor ? query : undefined)}
            className="text-xs text-[var(--acc-hi)] underline hover:text-[var(--acc)]"
          >
            {cursor ? 'Revenir au début' : 'Réinitialiser la recherche'}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="grid gap-3 xl:grid-cols-2 [&>li]:h-full">
            {page.items.map((member) => (
              // `.wow-reveal` class (not a framer wrapper) so `ul > li > a`
              // structure stays intact for the admin e2e; MemberRow keeps its
              // own HoverLift spring. CSS reveal is no-JS + reduced-motion safe.
              <li key={member.id} className="wow-reveal h-full">
                <MemberRow member={member} />
              </li>
            ))}
          </ul>

          {/* Pagination — cursor through the cohort while keeping the search. */}
          <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-2">
            {page.nextCursor ? (
              <Link
                href={membersHref(query, page.nextCursor)}
                prefetch={false}
                className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
              >
                Voir les membres plus anciens
              </Link>
            ) : null}
            <p className="t-foot text-center text-[var(--t-4)]">
              Affichage de {page.items.length} membre{page.items.length > 1 ? 's' : ''}
              {!query ? (
                <>
                  {' '}
                  · <span className="font-mono tabular-nums">{stats.total} au total</span>
                </>
              ) : null}
              {cursor ? (
                <>
                  {' · '}
                  <Link href={membersHref(query)} className="underline hover:text-[var(--t-2)]">
                    revenir au début
                  </Link>
                </>
              ) : null}
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}

function StatCell({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'mute' | 'ok' | 'warn' | 'bad' | 'acc';
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'bad'
          ? 'text-[var(--bad)]'
          : tone === 'acc'
            ? 'text-[var(--acc)]'
            : tone === 'mute'
              ? 'text-[var(--t-3)]'
              : 'text-[var(--t-1)]';

  // Colored top liseré + hover wash, per tone. Compositor-only (the number
  // micro-scales via `transform`; the cell tints via bg-color). The liseré is
  // a 2px ::before-like top bar built with a child span so we never touch the
  // grid's border-reset logic below.
  const accentBar =
    tone === 'ok'
      ? 'bg-[var(--ok)]'
      : tone === 'warn'
        ? 'bg-[var(--warn)]'
        : tone === 'bad'
          ? 'bg-[var(--bad)]'
          : tone === 'acc'
            ? 'bg-[var(--acc)]'
            : 'bg-[var(--b-strong)]';
  const hoverWash =
    tone === 'ok'
      ? 'hover:bg-[var(--ok-dim)]'
      : tone === 'warn'
        ? 'hover:bg-[var(--warn-dim)]'
        : tone === 'bad'
          ? 'hover:bg-[var(--bad-dim)]'
          : tone === 'acc'
            ? 'hover:bg-[var(--acc-dim)]'
            : 'hover:bg-[var(--bg-2)]';

  return (
    <div
      className={cn(
        'group/stat relative flex flex-col gap-1 overflow-hidden p-4 transition-colors duration-200',
        'border-r border-b border-[var(--b-default)] last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 [&:nth-child(2)]:border-b-0 sm:[&:nth-child(2)]:border-r',
        hoverWash,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 transition-transform duration-300 ease-out group-hover/stat:scale-x-100 motion-reduce:transition-none',
          accentBar,
        )}
      />
      <span className="t-eyebrow">{label}</span>
      <AnimatedNumber
        value={value}
        className={cn(
          'f-mono origin-left text-[22px] leading-none font-semibold tracking-[-0.02em] transition-transform duration-200 group-hover/stat:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover/stat:scale-100',
          valColor,
        )}
      />
      {hint ? <span className="t-mono-cap">{hint}</span> : null}
    </div>
  );
}
