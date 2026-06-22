'use client';

import { m, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * HoverGlowLift — S18 : combine le lift spring de HoverLift et le halo coloré
 * de `.wow-hover-glow` en UN seul wrapper, pour donner une affordance de survol
 * premium et colorée aux surfaces qui n'en avaient pas (cartes data-viz,
 * panneaux admin, rows). Répond à la demande « hover sur CHAQUE module ».
 *
 * INVARIANTS (frontend-elite)
 * - Compositor-only : le lift anime transform (scale+y) ; le glow est un
 *   box-shadow PEINT une fois sur un ::after dont seule l'OPACITÉ transitionne
 *   (cf. globals.css `.wow-hover-glow`) — jamais de box-shadow animé en continu.
 * - prefers-reduced-motion : `useReducedMotion()` retire le lift (surface
 *   statique) ; le filet global neutralise la transition du glow.
 * - forced-colors : le glow ::after est `display:none` (globals.css).
 * - Mono-accent : le halo est décoratif. Le CTA plein reste --acc bleu. `tone`
 *   ne change que la TEINTE du halo (familles de modules : cyan=training §21.7,
 *   indigo=séries data) — jamais un nouveau hue hors spectre cool autorisé.
 *
 * NE PAS utiliser sur une surface `glass` (backdrop-filter + transform entrent
 * en conflit — cf. card.tsx). Réservé aux cartes solides.
 */
const SPRING = { type: 'spring', stiffness: 310, damping: 22, mass: 0.7 } as const;

export interface HoverGlowLiftProps {
  children: ReactNode;
  className?: string;
  /** Teinte du halo de survol. Défaut bleu (--acc). */
  tone?: 'acc' | 'cy' | 'indigo';
  /** Glow seul, sans lift (pour les cartes contenant un <form>/hit-area sensible). */
  noLift?: boolean;
}

export function HoverGlowLift({ children, className, tone = 'acc', noLift }: HoverGlowLiftProps) {
  const reduced = useReducedMotion();
  const glow =
    tone === 'cy'
      ? 'wow-hover-glow wow-hover-glow-cy'
      : tone === 'indigo'
        ? 'wow-hover-glow wow-hover-glow-2'
        : 'wow-hover-glow';

  return (
    <m.div
      className={cn(glow, className)}
      transition={SPRING}
      {...(reduced || noLift
        ? {}
        : { whileHover: { scale: 1.02, y: -2 }, whileTap: { scale: 0.98 } })}
    >
      {children}
    </m.div>
  );
}
