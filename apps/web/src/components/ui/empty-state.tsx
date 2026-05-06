import { Info, Target, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Icon component from lucide-react. Default Target. */
  icon?: LucideIcon;
  /** Bold one-liner. Avoid blame ("Pas encore" > "Vous n'avez pas"). */
  headline: ReactNode;
  /** Lead paragraph (1-2 sentences, max ~36ch). */
  lead?: ReactNode;
  /** 1-3 numbered guides. Concrete, actionable. */
  guides?: ReactNode[];
  /** Optional cyan tip box (philosophical / pédago). */
  tip?: ReactNode;
  /** Primary CTA content (renders as Btn primary). */
  ctaPrimary?: ReactNode;
  /** Optional secondary CTA (renders as Btn ghost). */
  ctaSecondary?: ReactNode;
  /** Click handler for primary CTA. */
  onPrimary?: () => void;
  /** Click handler for secondary CTA. */
  onSecondary?: () => void;
  className?: string;
}

/**
 * EmptyState — 6 strates sémantiques :
 *   icon halo + headline + lead + numbered guides + cyan tip + dual CTA
 *
 * Posture pédago Fxmily : "anything can happen" (Douglas) — déculpabilisant,
 * orienté process, pas blame. Reframe absence comme étape normale.
 *
 * Usage : journal vide, dashboard premier jour, search no-results, etc.
 */
export function EmptyState({
  icon: Icon = Target,
  headline,
  lead,
  guides,
  tip,
  ctaPrimary,
  ctaSecondary,
  onPrimary,
  onSecondary,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      {/* Strate 1 : icon halo lime */}
      <div className="relative mb-5">
        <div aria-hidden className="absolute inset-0 rounded-full bg-[var(--acc-dim)] blur-2xl" />
        <div className="relative grid h-14 w-14 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]">
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
        </div>
      </div>

      {/* Strate 2 : headline */}
      <h3 className="t-h2 text-[var(--t-1)]">{headline}</h3>

      {/* Strate 3 : lead */}
      {lead ? <p className="t-body mt-1.5 max-w-[36ch] text-[var(--t-3)]">{lead}</p> : null}

      {/* Strate 4 : numbered guides */}
      {guides && guides.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-1.5 text-left">
          {guides.map((g, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12px]">
              <span
                aria-hidden
                className="mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] font-mono text-[10px] font-semibold tabular-nums text-[var(--acc)]"
              >
                {i + 1}
              </span>
              <span className="leading-[1.5] text-[var(--t-2)]">{g}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {/* Strate 5 : cyan tip box */}
      {tip ? (
        <div className="rounded-control mt-4 flex max-w-[42ch] items-start gap-2 border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] px-3 py-2 text-left">
          <Info
            aria-hidden
            className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--cy)]"
            strokeWidth={1.75}
          />
          <span className="t-cap text-[var(--t-2)]">{tip}</span>
        </div>
      ) : null}

      {/* Strate 6 : dual CTA */}
      {ctaPrimary || ctaSecondary ? (
        <div className="mt-5 flex gap-2">
          {ctaPrimary ? (
            <Btn kind="primary" size="m" onClick={onPrimary}>
              {ctaPrimary}
            </Btn>
          ) : null}
          {ctaSecondary ? (
            <Btn kind="ghost" size="m" onClick={onSecondary}>
              {ctaSecondary}
            </Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
