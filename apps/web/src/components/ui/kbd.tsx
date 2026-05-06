import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface KbdProps {
  children: ReactNode;
  /**
   * `inline` style is for kbd badges placed *inside* a button or pill
   * (transparent bg, blends with the parent surface).
   */
  inline?: boolean;
  className?: string;
}

/**
 * Keyboard shortcut badge. Pattern visible sous chaque CTA primary +
 * footer help line (⌘? raccourcis) — anchor visible des power-users.
 */
export function Kbd({ children, inline, className }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-mono text-[10px] font-medium tabular-nums leading-none',
        inline
          ? 'border border-white/15 bg-black/25 text-current'
          : 'border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
