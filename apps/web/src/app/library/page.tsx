import { BookOpen, Heart, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { AnimatedCardGrid } from '@/components/library/animated-card-grid';
import { CategoryFilterTabs } from '@/components/library/category-filter-tabs';
import { CATEGORY_LABEL } from '@/components/library/category-meta';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';
import {
  countUnseenDeliveries,
  listMyFavorites,
  listPublishedCards,
  listPublishedCategories,
} from '@/lib/cards/service';
import type { DouglasCategory } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: ReadonlySet<DouglasCategory> = new Set([
  'acceptance',
  'tilt',
  'discipline',
  'ego',
  'probabilities',
  'confidence',
  'patience',
  'consistency',
  'fear',
  'loss',
  'process',
]);

interface LibraryPageProps {
  searchParams: Promise<{ cat?: string; q?: string }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const params = await searchParams;
  const cat =
    typeof params.cat === 'string' && VALID_CATEGORIES.has(params.cat as DouglasCategory)
      ? (params.cat as DouglasCategory)
      : null;
  const q =
    typeof params.q === 'string' && params.q.trim().length > 0 ? params.q.trim() : undefined;

  const [cards, categories, favorites, unseenCount] = await Promise.all([
    listPublishedCards({
      ...(cat ? { category: cat } : {}),
      ...(q ? { q } : {}),
    }),
    listPublishedCategories(),
    listMyFavorites(session.user.id),
    countUnseenDeliveries(session.user.id),
  ]);

  const favoriteIds = new Set(favorites.map((f) => f.cardId));
  const totalCount = categories.reduce((acc, c) => acc + c.count, 0);

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-5xl px-4 pt-6 pb-24 md:pt-10">
        {/* Hero header */}
        <header className="mb-6 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span
                className="bg-acc-dim text-acc inline-flex h-9 w-9 items-center justify-center rounded-full shadow-[var(--acc-glow)]"
                aria-hidden
              >
                <BookOpen className="h-4 w-4" />
              </span>
              <Pill tone="acc">Module Mark Douglas</Pill>
            </div>
            <div className="flex items-center gap-2">
              {unseenCount > 0 && (
                <Link
                  href="/library/inbox"
                  className="rounded-pill border-acc/40 bg-acc/10 text-acc inline-flex h-9 items-center gap-2 border px-3 text-xs font-medium transition-all hover:scale-105"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {unseenCount} nouvelle{unseenCount > 1 ? 's' : ''}
                  </span>
                </Link>
              )}
              {favorites.length > 0 && (
                <Link
                  href="/library/favorites"
                  className="rounded-pill border-border bg-bg-1 text-foreground hover:border-acc/40 inline-flex h-9 items-center gap-2 border px-3 text-xs font-medium transition-all"
                >
                  <Heart className="h-3.5 w-3.5" />
                  <span>
                    {favorites.length} favori{favorites.length > 1 ? 's' : ''}
                  </span>
                </Link>
              )}
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Ta bibliothèque psychologie trader
          </h1>
          <p className="text-muted max-w-2xl text-sm leading-relaxed">
            Fiches inspirées de <em>Trading in the Zone</em> et <em>The Disciplined Trader</em> de
            Mark Douglas. Tu reçois automatiquement les fiches qui correspondent à ton état
            comportemental — et tu peux parcourir tout le catalogue à ta guise.
          </p>
          <DrawnRule className="mt-1 max-w-[220px]" />
        </header>

        {/* Filters */}
        <div className="mb-6">
          <CategoryFilterTabs entries={categories} active={cat} totalCount={totalCount} />
        </div>

        {/* Search — the `q` param was read server-side and wired to
            `listPublishedCards`, but there was NO input to set it (dead feature).
            Server-rendered GET form (works without JS, accessible). The hidden
            `cat` preserves the active category across the search. */}
        <form method="get" action="/library" role="search" className="mb-6 flex flex-col gap-2">
          <label htmlFor="library-search" className="sr-only">
            Rechercher une fiche par titre
          </label>
          <input type="hidden" name="cat" value={cat ?? ''} />
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--t-4)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <input
                id="library-search"
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Rechercher une fiche…"
                autoComplete="off"
                maxLength={100}
                className="rounded-card h-11 w-full border border-[var(--b-default)] bg-[var(--bg)] pr-3 pl-9 font-sans text-[14px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              />
            </div>
            <button type="submit" className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}>
              Rechercher
            </button>
            {q ? (
              <Link
                href={cat ? `/library?cat=${cat}` : '/library'}
                className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
                aria-label="Effacer la recherche"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                Effacer
              </Link>
            ) : null}
          </div>
          {q ? (
            <p className="t-cap text-[var(--t-3)]" role="status">
              Résultats pour «&nbsp;{q}&nbsp;»
            </p>
          ) : null}
        </form>

        {/* Grid */}
        {cards.length === 0 && q ? (
          // Search miss — the catalogue exists, the query just matched nothing.
          // Honest copy + a reset CTA (preserving the active category), never
          // the misleading "le catalogue arrive bientôt".
          <Card className="p-6">
            <EmptyState
              icon={Search}
              headline={`Aucune fiche pour « ${q} »`}
              lead={
                cat
                  ? `Aucune fiche de « ${CATEGORY_LABEL[cat]} » ne correspond à cette recherche. Essaie un autre mot, ou élargis à tout le catalogue.`
                  : 'Essaie un autre mot-clé, ou parcours simplement le catalogue par thématique.'
              }
              ctaPrimary={
                <>
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Effacer la recherche
                </>
              }
              ctaHref={cat ? `/library?cat=${cat}` : '/library'}
            />
          </Card>
        ) : cards.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={BookOpen}
              headline={
                cat
                  ? `Pas encore de fiche dans « ${CATEGORY_LABEL[cat]} »`
                  : 'Le catalogue arrive bientôt'
              }
              lead={
                cat
                  ? "Eliott publiera de nouvelles fiches dans cette thématique très bientôt. Reviens d'ici quelques jours."
                  : 'Eliott prépare la première vague de fiches Mark Douglas. Tu y auras accès dès la publication.'
              }
              tip="En attendant, fais un check-in de qualité aujourd'hui : c'est ce qui nourrit le système qui te poussera la bonne fiche au bon moment."
            />
          </Card>
        ) : (
          <AnimatedCardGrid cards={cards} favoritedIds={Array.from(favoriteIds)} />
        )}
      </div>
    </main>
  );
}
