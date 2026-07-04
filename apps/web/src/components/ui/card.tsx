import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Primary card with blue gradient + accent shadow. Use sparingly (1-2/écran). */
  primary?: boolean;
  /** Selected state with accent ring 4px. Mutually exclusive with `primary`. */
  selected?: boolean;
  /** Adds hover affordance (transform + accent border). */
  interactive?: boolean;
  /** Top edge gradient line (Linear pattern). Default true. */
  edge?: boolean;
  /**
   * DS-v3 (J3) glassmorphism 2.0 surface — frosted translucent panel
   * that reveals the ambient mesh behind it. With `primary`, adds the
   * luminous accent inner-glow (`.glow-edge`). Replaces the solid
   * bg/border/shadow; use on hero/info panels, not on transformed
   * (spring-lifted) surfaces — backdrop-filter + transform conflict.
   */
  glass?: boolean;
}

/**
 * Card — base surface primitive.
 *
 * Variants:
 * - default : premium paint (--bg-1 + .card-premium whisper + --sh-card)
 * - primary : blue gradient + Mercury 4-layer shadow
 * - selected : accent ring 4px + selected shadow
 * - interactive : adds hover state (border-strong + shadow-card-hover + lift)
 *
 * Multi-layer shadow obligatoire (jamais single-layer = AI-slop).
 * Edge-top : gradient subtle 1px en haut, signature Linear.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, primary, selected, interactive, edge = true, glass, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      data-primary={primary || undefined}
      data-selected={selected || undefined}
      data-glass={glass || undefined}
      // Tour 12 (D) — expose l'attribut que globals.css cible
      // (`[data-slot='card'][data-interactive]`) pour le hover systématique
      // (lift + halo central). Émis seulement quand la carte est réellement
      // interactive (jamais sur une surface de lecture).
      data-interactive={interactive && !selected ? '' : undefined}
      className={cn(
        'rounded-card border transition-[border-color,box-shadow,background-color,transform] duration-200',
        glass
          ? cn('glass-panel backdrop-blur-[16px] backdrop-saturate-150', primary && 'glow-edge')
          : primary
            ? 'border-[color:var(--b-strong)] bg-gradient-to-br from-[var(--bg-2)] to-[var(--bg-1)] shadow-[var(--sh-card-primary)]'
            : 'card-premium border-[color:var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)]',
        selected && '!border-[color:var(--b-acc)] shadow-[var(--sh-card-selected)]',
        // Le lift + press vivent dans la regle centrale globals.css
        // `[data-slot='card'][data-interactive]:not([data-glass])` — pas de
        // doublon utilitaire ici (translate + transform se composeraient
        // en -4px, dont 2px sans transition).
        interactive &&
          !selected &&
          'cursor-pointer hover:border-[color:var(--b-strong)] hover:shadow-[var(--sh-card-hover)]',
        edge && 'border-edge-top relative',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
