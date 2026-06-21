'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * GradientBorder — wrapper décoratif qui dessine un anneau lumineux premium
 * (bordure en dégradé de marque) autour de son contenu.
 *
 * RATIONALE
 * ---------
 * Donne aux surfaces « héros » (cartes 5-étoiles, panneaux first-run, KPIs
 * mis en avant) un liseré dégradé qui peut tourner lentement pour un effet
 * « anneau lumineux » premium, sans dépendance JS d'animation.
 *
 * Le rendu ET l'animation sont 100 % CSS, portés par la classe `.gradient-border`
 * définie dans globals.css :
 *   - `::before` peint un `conic-gradient(from var(--gb-angle), …)` qui tourne
 *     via `@keyframes` sur la custom property `@property --gb-angle`.
 *   - `@supports` fournit un fallback statique si `@property` est indisponible.
 *   - L'animation est `paused` par défaut, `running` au survol si
 *     `data-trigger="hover"`, et `running` en continu si `data-trigger="always"`.
 *   - `prefers-reduced-motion` et `forced-colors` sont gérés côté CSS.
 * Ce composant ne fait QUE fournir la structure DOM, les `data-*` attributs et
 * le rayon ; il ne contient aucune logique d'animation.
 *
 * INVARIANTS
 * ----------
 * - Utilise `--grad-brand` (bleu → indigo → cyan) : c'est l'identité de marque.
 * - DÉCORATIF uniquement — JAMAIS un CTA, jamais un élément interactif/focusable
 *   par lui-même. Toute interactivité vit dans `children`.
 * - L'épaisseur de l'anneau (padding 1px) et les rayons sont gérés par le CSS ;
 *   on n'expose que `--gb-radius` (réglable inline via la prop `radius`).
 * - L'enfant `.gradient-border-inner` porte la surface réelle (fond + radius
 *   légèrement inférieur) ; ne pas y appliquer de bordure concurrente.
 */
export interface GradientBorderProps {
  children: React.ReactNode;
  className?: string;
  /** 'hover' (tourne au survol) | 'always' (tourne en continu). Défaut 'hover'. */
  trigger?: 'hover' | 'always';
  /** Rayon CSS (ex '16px' ou 'var(--r-card-lg)'). Optionnel. */
  radius?: string;
  /** className de la surface interne. */
  innerClassName?: string;
}

export function GradientBorder({
  children,
  className,
  trigger = 'hover',
  radius,
  innerClassName,
}: GradientBorderProps) {
  return (
    <div
      className={cn('gradient-border', className)}
      data-trigger={trigger}
      style={radius ? ({ ['--gb-radius' as string]: radius } as React.CSSProperties) : undefined}
    >
      <div className={cn('gradient-border-inner', innerClassName)}>{children}</div>
    </div>
  );
}
