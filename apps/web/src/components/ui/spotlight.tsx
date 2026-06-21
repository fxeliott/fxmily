'use client';

/**
 * Spotlight — wrapper qui fait suivre une lueur radiale douce (accent bleu) au curseur.
 *
 * Rationale :
 * - L'effet visuel (overlay radial, opacity 0 → :hover, blend) vit ENTIÈREMENT dans
 *   `globals.css` sous la classe `.spotlight-surface`, peint via un pseudo-élément `::before`.
 * - Ce composant ne fait QUE deux choses : poser la classe `.spotlight-surface` et
 *   tenir à jour les deux custom properties `--spot-x` / `--spot-y` (en px, relatives au
 *   coin haut-gauche de l'hôte) au `pointermove`. Le CSS centre le masque radial dessus.
 *
 * Invariants (contrat avec globals.css — NE PAS dupliquer le CSS ici) :
 * - L'hôte porte `.spotlight-surface` : c'est cette classe (côté CSS) qui impose
 *   `position: relative` (ancrage de l'overlay `::before`) et qui gère opacity + hover.
 *   Le composant n'ajoute donc AUCUN nœud DOM d'overlay ni de style positionnel.
 * - Le pseudo `::before` est `pointer-events: none` et `aria-hidden` implicite (pseudo),
 *   donc purement décoratif, hors flux d'accessibilité.
 * - La mise à jour passe par `el.style.setProperty(...)` : elle ne repeint que le masque
 *   (compositing du `::before`), ne déclenche ni layout ni re-render React.
 * - Pas de gestion `prefers-reduced-motion` : l'effet est strictement pointer-driven
 *   (aucun mouvement autonome / animation en boucle), il ne se déclenche que sous l'action
 *   directe de l'utilisateur — rien à atténuer pour le confort vestibulaire.
 */

import { useCallback, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface SpotlightProps {
  children: React.ReactNode;
  className?: string;
}

export function Spotlight({ children, className }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <div ref={ref} className={cn('spotlight-surface', className)} onPointerMove={handlePointerMove}>
      {children}
    </div>
  );
}
