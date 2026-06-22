import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import type { SerializedCard } from '@/lib/cards/types';
import type { DouglasCategory } from '@/generated/prisma/enums';
import { cleanQuoteSource, isParaphraseQuote } from '@/lib/library/quote-display';

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
 * S18 — teinte data-viz cool (bleu/indigo/cyan, mono-accent safe) par catégorie,
 * pour le liseré supérieur décoratif qui réveille le catalogue. NE colore qu'un
 * dégradé décoratif (jamais un CTA) ; reste dans le spectre cool autorisé. Les 11
 * catégories sont réparties sur les 3 hues neutres via `var(--dv-1/2/3-edge)`.
 */
const CATEGORY_EDGE: Record<DouglasCategory, string> = {
  acceptance: 'var(--dv-3-edge)',
  tilt: 'var(--dv-2-edge)',
  discipline: 'var(--dv-1-edge)',
  ego: 'var(--dv-2-edge)',
  probabilities: 'var(--dv-3-edge)',
  confidence: 'var(--dv-1-edge)',
  patience: 'var(--dv-3-edge)',
  consistency: 'var(--dv-1-edge)',
  fear: 'var(--dv-2-edge)',
  loss: 'var(--dv-2-edge)',
  process: 'var(--dv-1-edge)',
};

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
  const edgeColor = CATEGORY_EDGE[card.category];

  return (
    <HoverLift className="block h-full">
      <Card
        interactive
        className="wow-hover-glow focus-within:ring-acc group relative flex h-full flex-col gap-3 p-5 focus-within:ring-2 focus-within:ring-offset-2"
        aria-labelledby={`card-${card.slug}-title`}
      >
        {/* S18 — liseré supérieur teinté par catégorie (data-viz cool, mono-accent
            safe). Décoratif : dégradé via var(--dv-*-edge), pointer-events:none, il
            ne couvre pas le <Link before:inset-0>. S'intensifie au group-hover.
            Inset horizontal 12px → épouse les coins arrondis (pas de bavure). */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 right-3 left-3 z-10 h-px opacity-70 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${edgeColor} 50%, transparent 100%)`,
          }}
        />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="bg-acc-dim text-acc inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200 group-hover:bg-[var(--acc)] group-hover:text-[var(--bg)]"
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
          className="text-foreground group-hover:text-acc text-base leading-snug font-semibold transition-colors"
        >
          <Link
            href={`/library/${card.slug}`}
            className="before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
          >
            {card.title}
          </Link>
        </h3>

        <blockquote className="border-acc/40 text-muted border-l-2 pl-3 text-sm italic">
          {isParaphraseQuote(card.quoteSourceChapter) ? (
            card.quote
          ) : (
            <>&laquo;&nbsp;{card.quote}&nbsp;&raquo;</>
          )}
          <footer className="text-muted mt-1 text-[10px] tracking-wide uppercase not-italic">
            {isParaphraseQuote(card.quoteSourceChapter)
              ? `D'après Mark Douglas — ${cleanQuoteSource(card.quoteSourceChapter)}`
              : card.quoteSourceChapter}
          </footer>
        </blockquote>
      </Card>
    </HoverLift>
  );
}
