import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedCard } from '@/lib/cards/types';

import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from './category-meta';
import { FavoriteToggle } from './favorite-toggle';

interface CardGridItemProps {
  card: SerializedCard;
  /** Whether the current member has favorited this card. */
  favorited: boolean;
  /** Whether a delivery for this card is unread. */
  hasUnread?: boolean;
}

/**
 * One card in the `/library` grid. Server Component (the heart toggle is the
 * sole client island).
 *
 * Visual hierarchy:
 *   1. Category icon + Pill at top — instant taxonomy.
 *   2. Title H3 — primary affordance.
 *   3. Quote excerpt italics — Mark Douglas voice anchor (≤ 30 words).
 *   4. Source attribution micro-text.
 *   5. Heart toggle absolute top-right + unread dot.
 *
 * Touch target ≥ 44px on the entire card via the `<Link>` overlay.
 */
export function CardGridItem({ card, favorited, hasUnread = false }: CardGridItemProps) {
  const Icon = CATEGORY_ICON[card.category];
  const tone = CATEGORY_TONE[card.category];

  return (
    <Card
      interactive
      className="group relative flex h-full flex-col gap-3 p-5"
      aria-labelledby={`card-${card.slug}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="bg-acc-dim text-acc inline-flex h-7 w-7 items-center justify-center rounded-full"
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <Pill tone={tone}>{CATEGORY_LABEL[card.category]}</Pill>
          {hasUnread && (
            <Pill tone="acc" dot="live">
              Nouvelle
            </Pill>
          )}
        </div>
        <FavoriteToggle cardId={card.id} initialFavorited={favorited} />
      </div>

      <h3
        id={`card-${card.slug}-title`}
        className="text-foreground group-hover:text-acc text-base font-semibold leading-snug transition-colors"
      >
        <Link
          href={`/library/${card.slug}`}
          className="before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
        >
          {card.title}
        </Link>
      </h3>

      <blockquote className="border-acc/40 text-muted border-l-2 pl-3 text-sm italic">
        &laquo;&nbsp;{card.quote}&nbsp;&raquo;
        <footer className="text-muted mt-1 text-[10px] uppercase not-italic tracking-wide">
          {card.quoteSourceChapter}
        </footer>
      </blockquote>
    </Card>
  );
}
