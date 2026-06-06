import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Primary card with lime gradient + accent shadow. Use sparingly (1-2/écran). */
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
 * - default : neutral elevation (--bg-1 + --sh-card)
 * - primary : lime gradient + Mercury 4-layer shadow
 * - selected : accent ring 4px + selected shadow
 * - interactive : adds hover state (border-strong + shadow-card-hover)
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
      className={cn(
        'rounded-card border transition-[border-color,box-shadow,background-color] duration-200',
        glass
          ? cn('glass-panel backdrop-blur-[16px] backdrop-saturate-150', primary && 'glow-edge')
          : primary
            ? 'border-[var(--b-strong)] bg-gradient-to-br from-[var(--bg-2)] to-[var(--bg-1)] shadow-[var(--sh-card-primary)]'
            : 'border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)]',
        selected && '!border-[var(--b-acc)] shadow-[var(--sh-card-selected)]',
        interactive &&
          !selected &&
          'cursor-pointer hover:border-[var(--b-strong)] hover:shadow-[var(--sh-card-hover)]',
        edge && 'border-edge-top relative',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
