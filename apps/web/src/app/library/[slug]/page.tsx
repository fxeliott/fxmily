import { ArrowLeft, BookOpen, Quote, Target } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { FavoriteToggle } from '@/components/library/favorite-toggle';
import { HelpfulFeedback } from '@/components/library/helpful-feedback';
import { SafeMarkdown } from '@/components/library/markdown';
import { MarkSeenOnMount } from '@/components/library/mark-seen-on-mount';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import {
  getDeliveryByCardSlug,
  getPublishedCardBySlug,
  isFavorite,
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
  const [favorited, delivery, bulkSeenCount] = await Promise.all([
    isFavorite(userId, card.id),
    getDeliveryByCardSlug(userId, slug),
    markDeliveriesForCardSeen(userId, card.id),
  ]);

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
    <main className="container mx-auto max-w-3xl px-4 pb-24 pt-4 md:pt-8">
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
        {/* Aurora halo lime behind the icon — signature focal point */}
        <div
          aria-hidden
          className="bg-acc-dim pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full opacity-50 blur-2xl"
        />
        <div className="relative flex flex-wrap items-center gap-2">
          <span
            className="bg-acc-dim text-acc inline-flex h-9 w-9 items-center justify-center rounded-full shadow-[0_0_24px_-2px_var(--acc-glow)]"
            aria-hidden
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <Pill tone={tone}>{CATEGORY_LABEL[card.category]}</Pill>
          {card.hatClass === 'black' && (
            <Pill tone="warn" dot aria-label="Cadre d'urgence — fiche tilt management">
              Cadre d&apos;urgence
            </Pill>
          )}
        </div>
        <h1
          className="f-display h-rise text-foreground relative text-[32px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[40px] md:text-[48px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          {card.title}
        </h1>
        <div className="relative flex items-center gap-3">
          <FavoriteToggle cardId={card.id} initialFavorited={favorited} variant="labeled" />
        </div>
      </header>

      {/* Mark Douglas quote — proeminent */}
      <Card primary className="mb-6 p-6">
        <div className="flex gap-4">
          <Quote className="text-acc h-6 w-6 shrink-0" aria-hidden />
          <figure className="flex flex-col gap-3">
            <blockquote className="text-foreground text-lg italic leading-relaxed md:text-xl">
              &laquo;&nbsp;{card.quote}&nbsp;&raquo;
            </blockquote>
            <figcaption className="text-muted flex items-center gap-2 text-xs uppercase tracking-wide">
              <BookOpen className="h-3 w-3" aria-hidden />
              <span>Mark Douglas — {card.quoteSourceChapter}</span>
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
              className="text-muted text-xs font-semibold uppercase tracking-wide"
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
                  className="border-acc/40 bg-acc-dim text-acc mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold tabular-nums"
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
    </main>
  );
}
