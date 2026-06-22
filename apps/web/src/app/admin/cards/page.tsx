import { BookOpen, Database, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CardActionsRow } from '@/components/admin/card-actions-row';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { Pill } from '@/components/ui/pill';
import { getCatalogStats, listAllCards } from '@/lib/admin/cards-service';
import { cn } from '@/lib/utils';
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
    <main className="relative mx-auto w-full max-w-[var(--w-app)] px-4 pt-6 pb-24 md:pt-10 lg:px-8 2xl:px-12">
      {/* S19.2 — align on the modern admin canon (members/reports): ambient mesh
          + f-display masthead + animated stat cells. Was the flattest admin page. */}
      <DashboardAmbient />
      <header className="relative mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-control grid h-9 w-9 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <BookOpen className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <Pill tone="acc">Admin</Pill>
        </div>
        <h1
          className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          Bibliothèque Mark Douglas
        </h1>
        <p className="t-body max-w-prose text-[var(--t-2)]">
          Catalogue des fiches éducatives. Active <strong>Publié</strong> pour exposer une fiche aux
          membres ; les triggers ne ciblent que les fiches publiées.
        </p>
      </header>

      {/* Stats strip — animated, tone-tinted, premium hover (admin canon). */}
      <div className="relative mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardStat label="Total" value={stats.totalCards} tone="acc" />
        <CardStat label="Publiées" value={stats.publishedCards} tone="ok" />
        <CardStat label="Brouillons" value={stats.draftCards} tone="mute" />
        <CardStat label="Avec triggers" value={stats.cardsWithTriggers} tone="cy" />
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
        <ul className="grid gap-3 xl:grid-cols-2 [&>li]:h-full">
          {cards.map((card) => {
            const Icon = CATEGORY_ICON[card.category];
            const tone = CATEGORY_TONE[card.category];
            return (
              <li key={card.id}>
                <Card className="h-full p-4">
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
                      <h2 className="text-base leading-snug font-semibold">
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

/** S19.2 — animated, tone-tinted stat cell for the catalogue strip (admin canon,
 *  mirrors the members/reports pattern). Solid surface + premium colored hover. */
function CardStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'acc' | 'ok' | 'mute' | 'cy';
}) {
  const surface =
    tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim)]'
      : tone === 'cy'
        ? 'border-[var(--cy-edge-soft)] bg-[var(--cy-dim)]'
        : tone === 'mute'
          ? 'border-[var(--b-default)] bg-[var(--bg-1)]'
          : 'border-[var(--b-acc)] bg-[var(--acc-dim)]';
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'cy'
        ? 'text-[var(--cy)]'
        : tone === 'mute'
          ? 'text-[var(--t-2)]'
          : 'text-[var(--t-1)]';
  const glowTone = tone === 'cy' ? 'cy' : tone === 'mute' ? 'indigo' : 'acc';
  return (
    <HoverGlowLift
      tone={glowTone}
      className={cn('rounded-card flex flex-col gap-1 border p-4 transition-colors', surface)}
    >
      <p className="t-cap tracking-wide text-[var(--t-3)] uppercase">{label}</p>
      <AnimatedNumber
        value={value}
        className={cn('f-mono text-[26px] leading-none font-bold tabular-nums', valColor)}
      />
    </HoverGlowLift>
  );
}
