import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface V18ThemeScopeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * V1.8 REFLECT — Theme scope wrapper.
 *
 * Applies the `.v18-theme` CSS variables overlay (defined in `globals.css`).
 * Existing DS-v2 components (Btn, Card, Pill, etc.) automatically render with
 * the blue+black palette when wrapped — zero refactor of consumer components.
 *
 * Posture (M4=C "Le miroir de ton exécution") : distinct visual identity for
 * the REFLECT module. Members see lime/deep-space on dashboard / journal /
 * checkin / library, and blue/cosmic-deep on /review + /reflect. Pattern
 * borrowed from Notion (per-workspace theming) and Linear (per-project zones).
 *
 * Always pair with a `min-h-dvh` ancestor so the bg gradient covers the full
 * viewport (the wrapper itself is `position: relative` for orb layout).
 */
export function V18ThemeScope({ children, className, ...rest }: V18ThemeScopeProps) {
  return (
    <div className={cn('v18-theme relative min-h-dvh', className)} {...rest}>
      {children}
    </div>
  );
}
