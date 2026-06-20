'use client';

import { Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface InfoDotProps {
  /** Tooltip/popover content. Plain string or rich JSX. */
  tip: ReactNode;
  /**
   * What this dot explains — builds a descriptive aria-label
   * ("Plus d'informations sur {label}") instead of the generic one (a11y fix
   * S11: a screen-reader user hears WHICH KPI the (i) explains).
   */
  label?: string;
  /** Side preference (default: top). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Custom max-width for the content. */
  width?: number;
  className?: string;
}

/**
 * InfoDot — small (i) icon that reveals a pédago explanation (KPI calc, healthy
 * target, R-multiples, streak rules…).
 *
 * S11 a11y refit: built on Radix **Popover** (not Tooltip) so the content is
 * reachable by TAP on touch — Fxmily is a mobile-first PWA and a Radix Tooltip
 * does not open on tap. Hybrid behaviour, best of both:
 *   - mouse  → opens on hover (pointerType 'mouse'), closes on leave;
 *   - touch  → opens on tap (click), the hover handlers ignore 'touch' pointers
 *              so a tap doesn't open-then-close;
 *   - keyboard → Enter/Space on the button toggles it.
 * `onOpenAutoFocus` is prevented so a hover-open never steals focus.
 */
export function InfoDot({ tip, label, side = 'top', width = 240, className }: InfoDotProps) {
  const [open, setOpen] = useState(false);
  const ariaLabel = label ? `Plus d'informations sur ${label}` : "Plus d'informations";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setOpen(false);
          }}
          className={cn(
            // 24px hit area (WCAG 2.5.8) without growing the visual icon: the
            // -m-1.5 cancels the extra box so inline layout is unchanged.
            '-m-1.5 inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[var(--t-4)] transition-colors hover:text-[var(--acc-hi)] focus-visible:text-[var(--acc-hi)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
            className,
          )}
        >
          <Info className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="center"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={{ maxWidth: width }}
        className="rounded-tooltip w-auto border border-[var(--b-strong)] bg-[var(--bg-3)] px-2.5 py-2 text-left text-[11px] leading-[1.45] font-normal tracking-normal text-[var(--t-2)] normal-case shadow-[var(--sh-tooltip)]"
      >
        {tip}
      </PopoverContent>
    </Popover>
  );
}
