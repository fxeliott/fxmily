import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Spinner } from '@/components/spinner';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

export const btnVariants = cva(
  'relative inline-flex items-center justify-center select-none whitespace-nowrap rounded-control font-medium transition-[background-color,box-shadow,transform,color,border-color] duration-150',
  {
    variants: {
      kind: {
        primary:
          'bg-[var(--acc)] text-[var(--acc-fg)] font-semibold shadow-[var(--sh-btn-pri)] hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] hover:-translate-y-px active:translate-y-0 active:shadow-[var(--sh-btn-pri)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hatch-disabled disabled:hover:translate-y-0',
        secondary:
          'bg-transparent text-[var(--t-1)] border border-[var(--b-strong)] hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] hover:text-[var(--acc-hi)] active:bg-[var(--acc-dim)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hatch-disabled',
        ghost:
          'bg-transparent text-[var(--t-3)] border border-transparent hover:text-[var(--t-1)] hover:bg-[var(--bg-2)] disabled:opacity-40 disabled:cursor-not-allowed',
        danger:
          'bg-transparent text-[var(--bad)] border border-[oklch(0.7_0.165_22_/_0.35)] hover:bg-[var(--bad-dim)] hover:border-[var(--bad)] disabled:opacity-40 disabled:cursor-not-allowed',
      },
      size: {
        s: 'h-8 px-3 text-[12px] gap-1',
        m: 'h-11 px-4 text-[13px] gap-1.5',
        l: 'h-12 px-5 text-[14px] gap-1.5',
      },
    },
    defaultVariants: {
      kind: 'primary',
      size: 'm',
    },
  },
);

export interface BtnProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof btnVariants> {
  children?: ReactNode;
  /** Keyboard shortcut hint shown as inline kbd badge (e.g. "↵", "N", "⌘K"). */
  kbd?: ReactNode;
  /** Loading state shows inline spinner and sets aria-busy. */
  loading?: boolean;
}

/**
 * Btn — design-system primary control.
 * 4 kinds × 3 sizes × 6 states (idle/hover/active/focus/disabled/loading).
 *
 * Touch target ≥ 44×44 sur size m/l (mobile-first WCAG 2.5.5).
 * Le focus-visible ring lime + offset 2px est appliqué globalement par
 * globals.css — pas besoin de le déclarer ici.
 */
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { kind, size, children, kbd, loading, disabled, type = 'button', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-slot="btn"
      data-loading={loading || undefined}
      className={cn(btnVariants({ kind, size }), className)}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size={14} className="-ml-0.5" />
          {children}
        </>
      ) : (
        <>
          {children}
          {kbd ? (
            <Kbd inline className="ml-1">
              {kbd}
            </Kbd>
          ) : null}
        </>
      )}
    </button>
  );
});
