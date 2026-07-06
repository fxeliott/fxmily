import { ArrowLeft, ArrowRight, BookOpen, Quote, Target } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { CardGridItem } from '@/components/library/card-grid-item';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { FavoriteToggle } from '@/components/library/favorite-toggle';
import { HelpfulFeedback } from '@/components/library/helpful-feedback';
import { SafeMarkdown } from '@/components/library/markdown';
import { MarkSeenOnMount } from '@/components/library/mark-seen-on-mount';
import { cleanQuoteSource, isParaphraseQuote } from '@/lib/library/quote-display';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';
import {
  getDeliveryByCardSlug,
  getPublishedCardBySlug,
  isFavorite,
  listMyFavorites,
  listPublishedCards,
  markDeliveriesForCardSeen,
} from '@/lib/cards/service';

export const dynamic = 'force-dynamic';

interface CardReaderPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CardReaderPage({ params }: CardReaderPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) notFound();

  const userId = session.user.id;

  // Bulk-mark all unseen deliveries for this card as seen — same pattern as
  // J4 trade detail page (`markAnnotationsSeenForTrade`). Member opens the
  // card → all unseen deliveries for it are dismissed from the badge.
  const [favorited, delivery, bulkSeenCount, sameCategory, myFavorites] = await Promise.all([
    isFavorite(userId, card.id),
    getDeliveryByCardSlug(userId, slug),
    markDeliveriesForCardSeen(userId, card.id),
    // f2 — « Continuer » : autres fiches publiées de la même catégorie.
    listPublishedCards({ category: card.category }),
    listMyFavorites(userId),
  ]);

  // f2 — exclut la fiche courante, garde 3 suggestions max.
  const favoriteIds = new Set(myFavorites.map((f) => f.cardId));
  const relatedCards = sameCategory.filter((c) => c.id !== card.id).slice(0, 3);

  // Audit if any deliveries were marked seen by opening this card (J7 BLOQUANT #2 fix).
  if (bulkSeenCount > 0) {
    await logAudit({
      action: 'douglas.delivery.bulk_seen',
      userId,
      metadata: { cardId: card.id, cardSlug: card.slug, count: bulkSeenCount },
    });
  }

  const Icon = CATEGORY_ICON[card.category];
  const tone = CATEGORY_TONE[card.category];

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-4xl px-4 pt-4 pb-24 md:pt-8 lg:px-8">
        {/* Mark linked delivery seen if we came from a contextual push. */}
        {delivery ? <MarkSeenOnMount deliveryId={delivery.id} /> : null}

        {/* Back link */}
        <div className="mb-4">
          <Link
            href="/library"
            className="rounded-pill border-border text-muted hover:border-acc/40 hover:text-foreground focus-visible:outline-acc inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Retour au catalogue</span>
          </Link>
        </div>

        {/* Why-this-card banner (only when we arrived via a contextual push). */}
        {delivery && (
          <div className="rounded-card border-acc/30 bg-acc/8 mb-5 border p-4">
            <div className="flex items-start gap-3">
              <span
                className="bg-acc text-acc-fg mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                aria-hidden
              >
                <Target className="h-3.5 w-3.5" />
              </span>
              <div className="flex-1 text-sm">
                <p className="text-foreground font-medium">Pourquoi cette fiche maintenant</p>
                <p className="text-muted mt-1">{delivery.triggeredBy}</p>
              </div>
            </div>
          </div>
        )}

        {/* Hero — premium polish J7.6 (halo glow icon + h-rise H1 t-display) */}
        <header className="relative mb-8 flex flex-col gap-3">
          <div className="relative flex flex-wrap items-center gap-2">
            <span
              className="bg-acc-dim text-acc inline-flex h-9 w-9 items-center justify-center rounded-full shadow-[var(--acc-glow)]"
              aria-hidden
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <Pill tone={tone}>{CATEGORY_LABEL[card.category]}</Pill>
            {card.hatClass === 'black' && (
              <Pill tone="warn" dot aria-label="Cadre d'urgence · fiche tilt management">
                Cadre d&apos;urgence
              </Pill>
            )}
          </div>
          <h1
            className="f-display h-rise text-foreground relative text-[32px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[40px] md:text-[48px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            {card.title}
          </h1>
          <div className="relative flex items-center gap-3">
            <FavoriteToggle cardId={card.id} initialFavorited={favorited} variant="labeled" />
          </div>
          <DrawnRule className="mt-1 max-w-[220px]" />
        </header>

        {/* Mark Douglas quote — proeminent (DS-v3 glass focal panel over the ambient mesh) */}
        <Card glass primary className="mb-6 p-6">
          <div className="flex gap-4">
            <Quote className="text-acc h-6 w-6 shrink-0" aria-hidden />
            <figure className="flex flex-col gap-3">
              <blockquote className="text-foreground text-lg leading-relaxed italic md:text-xl">
                {isParaphraseQuote(card.quoteSourceChapter) ? (
                  card.quote
                ) : (
                  <>&laquo;&nbsp;{card.quote}&nbsp;&raquo;</>
                )}
              </blockquote>
              <figcaption className="text-muted flex items-center gap-2 text-xs tracking-wide uppercase">
                <BookOpen className="h-3 w-3" aria-hidden />
                <span>
                  {isParaphraseQuote(card.quoteSourceChapter)
                    ? `D'après Mark Douglas · ${cleanQuoteSource(card.quoteSourceChapter)}`
                    : `Mark Douglas · ${card.quoteSourceChapter}`}
                </span>
              </figcaption>
            </figure>
          </div>
        </Card>

        {/* Paraphrase markdown — drop-cap premium magazine feel J7.6 */}
        <section className="mb-8" aria-labelledby="paraphrase-heading">
          <h2 id="paraphrase-heading" className="sr-only">
            Paraphrase
          </h2>
          <SafeMarkdown
            source={card.paraphrase}
            className="mx-auto max-w-[66ch] text-[15px] leading-relaxed"
            dropCap
          />
        </section>

        {/* Exercises */}
        {card.exercises.length > 0 && (
          <section
            className="rounded-card border-border bg-bg-2/40 mb-8 border p-5"
            aria-labelledby="exercises-heading"
          >
            <header className="mb-4 flex items-center gap-2">
              <Target className="text-acc h-4 w-4" aria-hidden />
              <h2
                id="exercises-heading"
                className="text-muted text-xs font-semibold tracking-wide uppercase"
              >
                {card.exercises.length === 1
                  ? 'Exercice à faire maintenant'
                  : `${card.exercises.length} exercices à faire maintenant`}
              </h2>
            </header>
            <ol className="flex flex-col gap-4">
              {card.exercises.map((ex, idx) => (
                <li key={ex.id} className="flex items-start gap-3">
                  <span
                    className="border-acc/40 bg-acc-dim text-acc-hi mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold tabular-nums"
                    aria-hidden
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-foreground font-medium">{ex.label}</p>
                    <SafeMarkdown
                      source={ex.description}
                      className="text-muted text-sm"
                      headingOffset={2}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Helpful feedback (only when this view came from a delivery) */}
        {delivery && <HelpfulFeedback deliveryId={delivery.id} initialHelpful={delivery.helpful} />}

        {/* f2 — « Continuer » : la fiche n'est plus un cul-de-sac. On propose
            d'autres fiches de la même catégorie (réutilise CardGridItem). À
            défaut de fiche sœur, au minimum un lien vers le catalogue filtré. */}
        {relatedCards.length > 0 ? (
          <section className="mt-12" aria-labelledby="continue-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="continue-heading"
                className="text-muted text-xs font-semibold tracking-wide uppercase"
              >
                Continuer · {CATEGORY_LABEL[card.category]}
              </h2>
              <Link
                href={`/library?cat=${card.category}`}
                className="text-acc hover:text-acc-hi inline-flex items-center gap-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                <span>Voir tout</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {relatedCards.map((c) => (
                <li key={c.id} className="h-full">
                  <CardGridItem card={c} favorited={favoriteIds.has(c.id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="mt-12">
            <Link
              href={`/library?cat=${card.category}`}
              className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}
            >
              <span>Voir les autres fiches {CATEGORY_LABEL[card.category]}</span>
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
