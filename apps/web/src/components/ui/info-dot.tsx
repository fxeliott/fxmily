'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface InfoDotProps {
  /** Tooltip content. Plain string or rich JSX. */
  tip: ReactNode;
  /** Side preference (default: top). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Custom max-width for the tooltip content. */
  width?: number;
  className?: string;
}

/**
 * InfoDot — small (i) icon trigger that reveals a pédago tooltip.
 *
 * Use for inline education : KPI label + (i) → tooltip explique le calcul,
 * la cible saine, etc. Délai 0ms (TooltipProvider configuré dans layout).
 *
 * Pattern critique pour Fxmily : breakeven probability, plan score,
 * R-multiples, streak rules, etc.
 */
export function InfoDot({ tip, side = 'top', width = 240, className }: InfoDotProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Plus d'informations"
          className={cn(
            'inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[var(--t-4)] transition-colors hover:text-[var(--acc)]',
            className,
          )}
        >
          <Info className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        style={{ maxWidth: width }}
        className="rounded-tooltip border border-[var(--b-strong)] bg-[var(--bg-3)] px-2.5 py-2 text-left text-[11px] leading-[1.45] font-normal tracking-normal text-[var(--t-2)] normal-case shadow-[var(--sh-tooltip)]"
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
