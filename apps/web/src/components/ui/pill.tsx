import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const pillVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border text-[11px] font-medium uppercase leading-none tracking-[0.10em] tabular-nums px-1.5 py-0.5 h-[18px]',
  {
    variants: {
      tone: {
        mute: 'border-[var(--b-default)] text-[var(--t-3)] bg-[var(--mute-dim)]',
        acc: 'border-[var(--b-acc)] text-[var(--acc-hi)] bg-[var(--acc-dim)]',
        ok: 'border-[var(--ok-edge)] text-[var(--ok)] bg-[var(--ok-dim)]',
        bad: 'border-[var(--bad-edge)] text-[var(--bad)] bg-[var(--bad-dim)]',
        warn: 'border-[var(--warn-edge)] text-[var(--warn)] bg-[var(--warn-dim)]',
        cy: 'border-[var(--cy-edge-soft)] text-[var(--cy)] bg-[var(--cy-dim)]',
        solid: 'border-[var(--acc)] text-[var(--acc-fg)] bg-[var(--acc-btn)]',
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
    <span
      data-slot="pill"
      data-tone={tone ?? 'mute'}
      className={cn(pillVariants({ tone }), className)}
    >
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
