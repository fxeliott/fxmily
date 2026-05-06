import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const pillVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border text-[10px] font-medium uppercase leading-none tracking-[0.10em] tabular-nums px-1.5 py-0.5 h-[18px]',
  {
    variants: {
      tone: {
        mute: 'border-[var(--b-default)] text-[var(--t-3)] bg-[oklch(0.604_0.02_257_/_0.04)]',
        acc: 'border-[var(--b-acc)] text-[var(--acc)] bg-[var(--acc-dim)]',
        ok: 'border-[oklch(0.804_0.181_145_/_0.35)] text-[var(--ok)] bg-[var(--ok-dim)]',
        bad: 'border-[oklch(0.7_0.165_22_/_0.35)] text-[var(--bad)] bg-[var(--bad-dim)]',
        warn: 'border-[oklch(0.834_0.158_80_/_0.35)] text-[var(--warn)] bg-[var(--warn-dim)]',
        cy: 'border-[oklch(0.789_0.139_217_/_0.30)] text-[var(--cy)] bg-[var(--cy-dim)]',
        solid: 'border-[var(--acc)] text-[var(--acc-fg)] bg-[var(--acc)]',
      },
    },
    defaultVariants: {
      tone: 'mute',
    },
  },
);

export interface PillProps extends VariantProps<typeof pillVariants> {
  children: ReactNode;
  /** Show a leading dot. `live` adds a pulse animation. */
  dot?: boolean | 'live';
  className?: string;
}

export function Pill({ tone, children, dot, className }: PillProps) {
  return (
    <span data-slot="pill" className={cn(pillVariants({ tone }), className)}>
      {dot && (
        <span
          aria-hidden
          className={cn('h-1 w-1 rounded-full bg-current', dot === 'live' && 'live-dot')}
        />
      )}
      {children}
    </span>
  );
}
