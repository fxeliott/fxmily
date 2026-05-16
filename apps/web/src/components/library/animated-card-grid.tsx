'use client';

import { m, useReducedMotion } from 'framer-motion';

import type { SerializedCard } from '@/lib/cards/types';

import { CardGridItem } from './card-grid-item';

interface AnimatedCardGridProps {
  cards: SerializedCard[];
  /** Card IDs the current member has favorited. Serialized array (Sets aren't JSON-safe). */
  favoritedIds: string[];
}

/**
 * J7.5 polish — staggered entrance for `/library` catalog grid.
 *
 * Client island wrapping the Server-rendered `<CardGridItem>` (which is
 * itself a Server Component but contains the `<FavoriteToggle>` client
 * island). Each `<m.li>` fades + lifts 8px with `--e-smooth` easing,
 * staggered by 50ms.
 *
 * Respects `prefers-reduced-motion` — when set, `initial="show"` makes the
 * grid render immediately without animation.
 */
export function AnimatedCardGrid({ cards, favoritedIds }: AnimatedCardGridProps) {
  const prefersReducedMotion = useReducedMotion();
  const favoritedSet = new Set(favoritedIds);

  const containerVariants = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.05, delayChildren: 0.08 },
        },
      };

  const itemVariants = prefersReducedMotion
    ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } }
    : {
        hidden: { opacity: 0, y: 8 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
        },
      };

  return (
    <m.ul
      initial="hidden"
      animate="show"
      variants={containerVariants}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {cards.map((card) => (
        <m.li key={card.id} variants={itemVariants}>
          <CardGridItem card={card} favorited={favoritedSet.has(card.id)} />
        </m.li>
      ))}
    </m.ul>
  );
}
