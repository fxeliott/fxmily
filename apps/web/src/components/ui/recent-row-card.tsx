import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { Spotlight } from '@/components/ui/spotlight';
import { cn } from '@/lib/utils';

/**
 * Tour 11 (finding 2) — RecentRowCard, the reusable "living row" wrapper.
 *
 * The cursor Spotlight glow used to live ONLY inside TradeCard; every other
 * recent-activity row (reflections, weekly reviews, mindset + debrief
 * timelines) was a flat hand-rolled Card whose only hover affordance was a
 * border colour. This wrapper factors out the exact TradeCard grammar so those
 * rows come alive with the same premium feel:
 *   - Card `interactive` (spring lift on hover, when the row navigates)
 *   - `.wow-hover-glow` (accent glow-edge on hover/focus)
 *   - `.row-hover` (2px accent slide-in on the left edge)
 *   - `<Spotlight>` (radial glow tracking the pointer, CSS-only, decorative)
 *   - an OPTIONAL 3px left accent bar (`grid-cols-[3px_1fr]`), tinted with the
 *     neutral system accent `var(--acc)` by default.
 *
 * POSTURE §31.2 / Mark Douglas: the accent bar is a calm system accent, NEVER
 * red. Red is reserved for trade OUTCOMES (DS-v3 finance grammar) and is not an
 * option here by construction.
 *
 * a11y: the Spotlight overlay is a decorative pointer-driven pseudo-element
 * (aria-hidden, pointer-events:none) and needs no reduced-motion handling (it
 * only reacts to direct pointer input, no autonomous loop). When `href` is set
 * the whole row is a single focusable Link carrying the caller's `aria-label`;
 * without `href` it renders a plain, non-interactive surface (read-only
 * timelines that ship no detail route).
 */

export interface RecentRowCardProps {
  /** Row content — the caller owns the inner markup (header / dl / copy). */
  children: ReactNode;
  /** When set, the whole row navigates here (Link). Absent → read-only surface. */
  href?: string;
  /** Accessible label for the navigable row (screen-reader summary). */
  ariaLabel?: string;
  /**
   * `aria-current` for the row (e.g. the selected month in a `?id=` timeline).
   * Only meaningful with `href`.
   */
  current?: boolean;
  /**
   * Show the 3px left accent bar. Neutral `var(--acc)` by default; pass a token
   * var (e.g. `var(--cy)`) to retint an identity surface. NEVER a red/outcome
   * token (posture §31.2) — callers pass calm accents only.
   */
  accentBar?: boolean;
  /** Accent bar colour (CSS `<color>`). Defaults to the system accent. */
  accentColor?: string;
  /** Extra classes on the outer Link / wrapper (layout only). */
  className?: string;
  /** Extra classes on the inner content cell (padding, gap). Defaults to `p-4`. */
  contentClassName?: string;
}

/** Inner surface (Card + Spotlight + optional accent bar). Shared by both paths. */
function RowSurface({
  children,
  interactive,
  accentBar,
  accentColor,
  contentClassName,
}: {
  children: ReactNode;
  interactive: boolean;
  accentBar: boolean;
  accentColor: string | undefined;
  contentClassName: string | undefined;
}) {
  return (
    <Card
      interactive={interactive}
      className="wow-hover-glow row-hover relative overflow-hidden p-0"
    >
      <Spotlight className="rounded-[inherit]">
        <div
          className={cn(
            'grid items-stretch gap-0',
            accentBar ? 'grid-cols-[3px_1fr]' : 'grid-cols-1',
          )}
        >
          {accentBar ? (
            <div
              aria-hidden
              className="h-full w-[3px]"
              style={{ background: accentColor ?? 'var(--acc)' }}
            />
          ) : null}
          <div className={cn('flex min-w-0 flex-col', contentClassName ?? 'p-4')}>{children}</div>
        </div>
      </Spotlight>
    </Card>
  );
}

export function RecentRowCard({
  children,
  href,
  ariaLabel,
  current,
  accentBar = false,
  accentColor,
  className,
  contentClassName,
}: RecentRowCardProps) {
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'group rounded-card block focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
          className,
        )}
      >
        <RowSurface
          interactive
          accentBar={accentBar}
          accentColor={accentColor}
          contentClassName={contentClassName}
        >
          {children}
        </RowSurface>
      </Link>
    );
  }

  return (
    <div className={cn('block', className)}>
      <RowSurface
        interactive={false}
        accentBar={accentBar}
        accentColor={accentColor}
        contentClassName={contentClassName}
      >
        {children}
      </RowSurface>
    </div>
  );
}
