'use client';

/**
 * Reveal — apparition au scroll (opacity + glissement vertical léger).
 *
 * RATIONALE
 * Fallback JS fiable de la classe CSS `.wow-reveal`, qui repose sur
 * `animation-timeline: view()` (scroll-driven animations) — non supporté par
 * Firefox à ce jour. Ce composant reproduit l'effet via framer-motion
 * (`whileInView`), qui fonctionne sur tous les navigateurs cibles.
 *
 * INVARIANTS
 * - Compositor-only : on n'anime QUE `opacity` et `translateY`. Jamais de
 *   layout/paint (pas de width/height/top/margin) → 60fps garanti.
 * - LazyMotion strict : import depuis `'framer-motion'` et usage via l'alias
 *   `m.*` (jamais `motion.*`, jamais `'motion/react'`).
 * - Reduced-motion : si l'utilisateur préfère réduire les animations, on rend
 *   un `<div>` statique déjà dans son état final (visible, non décalé) — aucune
 *   animation, aucune transition.
 * - `RevealGroup` ne fait que déléguer : chaque enfant est enveloppé dans un
 *   `<Reveal>` avec un `delay` croissant. Le no-op reduced-motion est donc géré
 *   enfant par enfant par `Reveal` lui-même.
 */

import { m, useReducedMotion } from 'framer-motion';
import type { JSX, ReactNode } from 'react';
import { Children } from 'react';

import { cn } from '@/lib/utils';

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Décalage d'entrée vertical en px. Défaut 14. */
  y?: number;
  /** Délai (ms) — pour staggers manuels. Défaut 0. */
  delay?: number;
  /** Rejoue à chaque entrée ou une seule fois. Défaut true (once). */
  once?: boolean;
}

export function Reveal({
  children,
  className,
  y = 14,
  delay = 0,
  once = true,
}: RevealProps): JSX.Element {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: 0.2 }}
      transition={{
        duration: 0.55,
        ease: [0.22, 1, 0.36, 1],
        delay: delay / 1000,
      }}
    >
      {children}
    </m.div>
  );
}

export interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  /** Pas de décalage entre enfants en ms. Défaut 70. */
  stagger?: number;
  y?: number;
  once?: boolean;
}

export function RevealGroup({
  children,
  className,
  stagger = 70,
  y = 14,
  once = true,
}: RevealGroupProps): JSX.Element {
  return (
    <div className={cn(className)}>
      {Children.toArray(children).map((child, index) => (
        <Reveal key={index} delay={index * stagger} y={y} once={once}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
