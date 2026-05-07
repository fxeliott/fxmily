import { BookOpen, Database, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CardActionsRow } from '@/components/admin/card-actions-row';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { getCatalogStats, listAllCards } from '@/lib/admin/cards-service';
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

interface AdminCardsPageProps {
  searchParams: Promise<{ cat?: string; status?: string }>;
}

export default async function AdminCardsPage({ searchParams }: AdminCardsPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login');
  }

  const params = await searchParams;
  const cat =
    typeof params.cat === 'string' && VALID_CATEGORIES.has(params.cat as DouglasCategory)
      ? (params.cat as DouglasCategory)
      : undefined;
  const statusFilter =
    params.status === 'published' ? true : params.status === 'draft' ? false : undefined;

  const [cards, stats] = await Promise.all([
    listAllCards({
      ...(cat ? { category: cat } : {}),
      ...(statusFilter !== undefined ? { published: statusFilter } : {}),
    }),
    getCatalogStats(),
  ]);

  return (
    <main className="container mx-auto max-w-6xl px-4 pb-24 pt-6 md:pt-10">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-acc-dim text-acc inline-flex h-9 w-9 items-center justify-center rounded-full">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
          <Pill tone="acc">Admin</Pill>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Bibliothèque Mark Douglas
        </h1>
        <p className="text-muted text-sm">
          Catalogue des fiches éducatives. Active <strong>Publié</strong> pour exposer une fiche aux
          membres ; les triggers ne ciblent que les fiches publiées.
        </p>
      </header>

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Total</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.totalCards}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Publiées</p>
          <p className="text-acc mt-1 text-2xl font-semibold tabular-nums">
            {stats.publishedCards}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Brouillons</p>
          <p className="text-muted mt-1 text-2xl font-semibold tabular-nums">{stats.draftCards}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Avec triggers</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.cardsWithTriggers}</p>
        </Card>
      </div>

      {/* Filter strip */}
      <nav aria-label="Filtres" className="mb-5 flex flex-wrap gap-2">
        {(
          [
            { label: 'Tout', href: '/admin/cards', active: !cat && statusFilter === undefined },
            {
              label: 'Publiées',
              href: '/admin/cards?status=published',
              active: statusFilter === true,
            },
            {
              label: 'Brouillons',
              href: '/admin/cards?status=draft',
              active: statusFilter === false,
            },
          ] as const
        ).map((f) => (
          <Link
            key={f.label}
            href={f.href}
            aria-current={f.active ? 'page' : undefined}
            className={
              'rounded-pill inline-flex h-9 items-center border px-4 text-xs font-medium transition-all ' +
              (f.active
                ? 'border-acc/60 bg-acc/15 text-acc'
                : 'border-border bg-bg-1 text-foreground/85 hover:border-acc/40')
            }
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {cards.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Database}
            headline="Le catalogue est vide pour ce filtre"
            lead={
              !cat && statusFilter === undefined
                ? 'Lance le seed initial pour ingérer la première vague de fiches.'
                : 'Aucune fiche ne correspond à ce filtre. Essaie un autre statut ou catégorie.'
            }
            tip={
              <>
                Pour seeder les 50 fiches initiales :
                <code className="bg-muted/30 mx-1 rounded px-1 py-0.5 font-mono text-[11px]">
                  pnpm exec tsx scripts/seed-mark-douglas-cards.ts
                </code>
              </>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((card) => {
            const Icon = CATEGORY_ICON[card.category];
            const tone = CATEGORY_TONE[card.category];
            return (
              <li key={card.id}>
                <Card className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="text-acc h-4 w-4" aria-hidden />
                        <Pill tone={tone}>{CATEGORY_LABEL[card.category]}</Pill>
                        {card.triggerRules ? (
                          <Pill tone="cy">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            <span>{card.triggerRules.kind.replace(/_/g, ' ')}</span>
                          </Pill>
                        ) : (
                          <Pill tone="mute">Catalogue</Pill>
                        )}
                        {card.hatClass === 'black' && <Pill tone="warn">Black hat</Pill>}
                        <Pill tone="mute">P{card.priority}</Pill>
                      </div>
                      <h2 className="text-base font-semibold leading-snug">
                        <Link
                          href={`/library/${card.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-acc"
                        >
                          {card.title}
                        </Link>
                      </h2>
                      <p className="text-muted text-xs">
                        <span className="font-mono">{card.slug}</span>{' '}
                        <span className="text-foreground/40">·</span> {card.quoteSourceChapter}
                      </p>
                    </div>
                    <CardActionsRow
                      cardId={card.id}
                      initialPublished={card.published}
                      cardTitle={card.title}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
