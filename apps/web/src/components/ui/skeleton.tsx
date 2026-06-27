import type { CSSProperties, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Render as a circle (avatar / icon placeholder). */
  circle?: boolean;
}

/**
 * Skeleton — primitive de chargement unifiée du design system (S9).
 *
 * Wrappe la classe `.skel` (shimmer + radius token) en lui ajoutant
 * `data-slot` + `aria-hidden`. Le shimmer est neutralisé automatiquement
 * sous `prefers-reduced-motion` par le filet global de `globals.css`.
 *
 * Dimensionne via `className` (`h-4 w-32`, etc.). Pour reproduire un layout
 * précis (anti-CLS), compose plusieurs `<Skeleton>` aux dimensions exactes du
 * contenu chargé — cf. les skeletons bespoke (mindset, training, track).
 */
export function Skeleton({ circle, style, className, ...props }: SkeletonProps) {
  // `.skel` est unlayered (sa radius 4px battrait une utility `rounded-*`) →
  // pour le cercle on passe par le style inline qui prime sur la feuille.
  const mergedStyle: CSSProperties | undefined = circle
    ? { borderRadius: '9999px', ...style }
    : style;

  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('skel', className)}
      style={mergedStyle}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Nombre de lignes simulées. Défaut 3. */
  lines?: number;
  className?: string;
}

/**
 * SkeletonText — N lignes de texte simulées (la dernière plus courte) pour un
 * fallback de chargement honnête et lisible sur les blocs textuels.
 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div data-slot="skeleton-text" aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
