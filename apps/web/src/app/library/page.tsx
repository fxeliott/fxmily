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
import { cn } from '@/lib/utils';
import {
  countUnseenDeliveries,
  listMyFavorites,
  listPublishedCards,
  listPublishedCategories,
  listUnseenDeliveryCardIds,
} from '@/lib/cards/service';
import type { DouglasCategory } from '@/generated/prisma/enums';
import { NextStepRail } from '@/components/nav/next-step-rail';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bibliothèque' };

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

  const [cards, categories, favorites, unseenCount, unreadCardIds] = await Promise.all([
    listPublishedCards({
      ...(cat ? { category: cat } : {}),
      ...(q ? { q } : {}),
    }),
    listPublishedCategories(),
    listMyFavorites(session.user.id),
    countUnseenDeliveries(session.user.id),
    // S19.2 — feed the catalogue's dead "Nouvelle" badge with the real unseen set.
    listUnseenDeliveryCardIds(session.user.id),
  ]);

  const favoriteIds = new Set(favorites.map((f) => f.cardId));
  const totalCount = categories.reduce((acc, c) => acc + c.count, 0);

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-6xl px-4 pt-6 pb-24 md:pt-10 lg:px-8">
        {/* Hero header — aligné sur la grammaire DS des pages sœurs
            (eyebrow t-eyebrow-lg + h1 f-display h-rise + lead t-lead). */}
        <header className="mb-6 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
                <BookOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Module Mark Douglas
              </span>
              <h1
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Ta bibliothèque psychologie trader
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {unseenCount > 0 && (
                <Link
                  href="/library/inbox"
                  className="rounded-pill inline-flex h-9 items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 text-xs font-medium text-[var(--acc-hi)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {unseenCount} nouvelle{unseenCount > 1 ? 's' : ''}
                  </span>
                </Link>
              )}
              {favorites.length > 0 && (
                <Link
                  href="/library/favorites"
                  className="rounded-pill inline-flex h-9 items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-xs font-medium text-[var(--t-1)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--b-acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                >
                  <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {favorites.length} favori{favorites.length > 1 ? 's' : ''}
                  </span>
                </Link>
              )}
            </div>
          </div>
          <p className="t-lead max-w-2xl text-[var(--t-2)]">
            Fiches inspirées de <em>Trading in the Zone</em> et <em>The Disciplined Trader</em> de
            Mark Douglas. Tu reçois automatiquement les fiches qui correspondent à ton état
            comportemental, et tu peux parcourir tout le catalogue à ta guise.
          </p>
          <DrawnRule className="mt-1 max-w-[220px]" />
        </header>

        <NextStepRail currentPath="/library" />

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
                // S18 — input glass-panel frosté (révèle l'ambient mesh) + focus
                // ring acc. `.glass-panel` apporte bg translucide + border ; le
                // focus override la border en --acc.
                className="glass-panel rounded-card h-11 w-full pr-3 pl-9 font-sans text-[14px] text-[var(--t-1)] backdrop-blur-[16px] backdrop-saturate-150 transition-colors duration-200 placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
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
          <AnimatedCardGrid
            cards={cards}
            favoritedIds={Array.from(favoriteIds)}
            unreadIds={unreadCardIds}
          />
        )}
      </div>
    </main>
  );
}
