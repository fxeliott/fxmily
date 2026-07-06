import { Info, Target, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Btn, btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Icon component from lucide-react. Default Target. */
  icon?: LucideIcon;
  /**
   * Optional custom illustration (e.g. a maison SVG from
   * `components/illustrations/`). When provided, it REPLACES the top visual
   * strate (the icon halo) entirely — the icon prop is then ignored. Keep it
   * decorative (`aria-hidden`) and self-sizing; a `max-w` on the passed node
   * bounds it. When absent, the icon halo renders unchanged (zero breaking
   * change for the ~35 existing call-sites).
   */
  illustration?: ReactNode;
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
  /**
   * Navigation target for the primary CTA — renders a `<Link>` styled as the
   * primary Btn. A Server Component cannot pass `onPrimary` (functions don't
   * serialize across the RSC boundary), so navigation CTAs MUST use this prop
   * or the rendered button does nothing when clicked.
   */
  ctaHref?: string;
  /** Click handler for primary CTA. */
  onPrimary?: () => void;
  /** Click handler for secondary CTA. */
  onSecondary?: () => void;
  /**
   * Heading level for the headline. Default `h2` so the hierarchy stays
   * sane (the page typically owns `h1`). Pass `h3` only when the empty
   * state lives inside a section that already owns a deeper heading.
   * Phase P review WCAG B3 — was hard-coded `h3` and skipped the
   * hierarchy on every page that uses it.
   */
  headingLevel?: 'h2' | 'h3';
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
  illustration,
  headline,
  lead,
  guides,
  tip,
  ctaPrimary,
  ctaSecondary,
  ctaHref,
  onPrimary,
  onSecondary,
  headingLevel = 'h2',
  className,
}: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      {/* Strate 1 : illustration maison si fournie, sinon halo d'icône. La
          custom illustration REMPLACE le halo (une seule strate visuelle en
          tête), bornée en largeur pour rester premium et ne jamais dominer. */}
      {illustration ? (
        <div aria-hidden className="mb-5 w-full max-w-[220px]">
          {illustration}
        </div>
      ) : (
        <div className="relative mb-5">
          <div aria-hidden className="absolute inset-0 rounded-full bg-[var(--acc-dim)] blur-2xl" />
          <div className="relative grid h-14 w-14 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]">
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
          </div>
        </div>
      )}

      {/* Strate 2 : headline */}
      <Heading className="t-h2 text-[var(--t-1)]">{headline}</Heading>

      {/* Strate 3 : lead */}
      {lead ? <p className="t-body mt-1.5 max-w-[36ch] text-[var(--t-3)]">{lead}</p> : null}

      {/* Strate 4 : numbered guides */}
      {guides && guides.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-1.5 text-left">
          {guides.map((g, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12px]">
              <span
                aria-hidden
                className="mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] font-mono text-[10px] font-semibold text-[var(--acc)] tabular-nums"
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
        <div className="rounded-control mt-4 flex max-w-[42ch] items-start gap-2 border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-3 py-2 text-left">
          <Info
            aria-hidden
            className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--cy)]"
            strokeWidth={1.75}
          />
          {/* `.t-cap` bakes `color:var(--t-3)` and is UNLAYERED (after `@layer
              base` l.342) so it shadows `text-[var(--t-1)]` — runtime measured
              rgb(122,130,142)=--t-3 = 4.17:1 on the Card-primary gradient worst
              stop. Reproduce the caption inline (no baked colour) so `--t-1`
              actually paints (~13:1 on the dark stop), AA-clear + the legibility
              the pedagogical tip deserves. */}
          <span className="text-[11px] leading-[1.45] text-[var(--t-1)]">{tip}</span>
        </div>
      ) : null}

      {/* Strate 6 : dual CTA */}
      {ctaPrimary || ctaSecondary ? (
        <div className="mt-5 flex gap-2">
          {ctaPrimary && ctaHref ? (
            <Link href={ctaHref} className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
              {ctaPrimary}
            </Link>
          ) : ctaPrimary ? (
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
