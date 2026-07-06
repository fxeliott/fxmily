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
 *     via `@keyframes` sur la custom property `@property --gb-angle`, MASQUÉ en
 *     anneau (`mask-composite: exclude`) : seul le liseré est peint, jamais la
 *     surface — un inner transparent est donc sans danger.
 *   - `@supports` fournit un fallback statique si `@property` est indisponible.
 *   - L'animation est `paused` par défaut, `running` au survol si
 *     `data-trigger="hover"`, et `running` en continu si `data-trigger="always"`.
 *   - `prefers-reduced-motion` et `forced-colors` sont gérés côté CSS.
 *   - `variant="beam"` : liseré bleu subtil + segment lumineux qui parcourt le
 *     périmètre + glow ambiant — l'accent mono-focal premium (dashboard).
 * Ce composant ne fait QUE fournir la structure DOM, les `data-*` attributs et
 * le rayon ; il ne contient aucune logique d'animation.
 *
 * INVARIANTS
 * ----------
 * - Utilise `--grad-brand` (bleu → indigo → cyan) : c'est l'identité de marque.
 * - DÉCORATIF uniquement — JAMAIS un CTA, jamais un élément interactif/focusable
 *   par lui-même. Toute interactivité vit dans `children`.
 * - L'épaisseur de l'anneau (`--gb-width`, 1px / 1.5px en beam) et les rayons
 *   sont gérés par le CSS ; on n'expose que `--gb-radius` (prop `radius`).
 * - L'enfant `.gradient-border-inner` porte la surface réelle (fond + radius
 *   légèrement inférieur) ; ne pas y appliquer de bordure concurrente.
 */
export interface GradientBorderProps {
  children: React.ReactNode;
  className?: string;
  /** 'hover' (tourne au survol) | 'always' (tourne en continu). Défaut 'hover'. */
  trigger?: 'hover' | 'always';
  /**
   * 'ring' (anneau plein qui tourne, défaut) | 'beam' (liseré bleu subtil +
   * segment lumineux qui parcourt le périmètre + glow ambiant).
   */
  variant?: 'ring' | 'beam';
  /** Rayon CSS (ex '16px' ou 'var(--r-card-lg)'). Optionnel. */
  radius?: string;
  /** className de la surface interne. */
  innerClassName?: string;
}

export function GradientBorder({
  children,
  className,
  trigger = 'hover',
  variant = 'ring',
  radius,
  innerClassName,
}: GradientBorderProps) {
  return (
    <div
      className={cn('gradient-border', className)}
      data-trigger={trigger}
      data-variant={variant === 'beam' ? 'beam' : undefined}
      style={radius ? ({ ['--gb-radius' as string]: radius } as React.CSSProperties) : undefined}
    >
      <div className={cn('gradient-border-inner', innerClassName)}>{children}</div>
    </div>
  );
}
