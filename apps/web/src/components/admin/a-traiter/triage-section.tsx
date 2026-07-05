import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

/**
 * Tour 13 — one section of the coach's « À traiter » work queue.
 *
 * A titled `Card` holding: an icon chip + heading + a live count Pill, then the
 * cohort-wide rows for that signal (each a full-width link straight to the
 * surface where the coach acts), a calm positive empty state, and a « voir
 * plus » cursor link when more rows remain.
 *
 * Posture (SPEC §2) : factual, never punitive. The count Pill uses the section
 * accent (blue / cyan / amber), never red — red stays reserved for a trade's
 * own realized outcome (shown inside a row, not on the queue chrome).
 */

export type TriageTone = 'acc' | 'cy' | 'warn';

/** One rendered row: a heading line, a muted meta line, an optional trailing
 *  badge (e.g. the trade's realized R), and where the row links to. */
export interface TriageRow {
  readonly id: string;
  readonly href: string;
  /** Primary line — who + what (e.g. « Jean Dupont · EURUSD Long »). */
  readonly title: string;
  /** Secondary muted line — when / context. */
  readonly meta: string;
  /** Optional trailing content (kept to the right, e.g. a result badge). */
  readonly trailing?: React.ReactNode;
  /** Accessible label for the row link. */
  readonly ariaLabel: string;
}

export interface TriageSectionProps {
  icon: LucideIcon;
  title: string;
  tone: TriageTone;
  /** Total for this signal across the cohort (drives the count Pill). */
  count: number;
  rows: readonly TriageRow[];
  /** Copy shown when `count` is 0 — always calm and positive. */
  emptyLabel: string;
  /** Href for the « voir plus » link, or null when this is the last page. */
  moreHref?: string | null;
  /** Number of rows shown on this page (for the footer summary). */
  shownCount?: number;
}

export function TriageSection({
  icon: Icon,
  title,
  tone,
  count,
  rows,
  emptyLabel,
  moreHref = null,
  shownCount,
}: TriageSectionProps) {
  const isEmpty = count === 0;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'rounded-control grid h-9 w-9 shrink-0 place-items-center border',
              tone === 'acc' && 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]',
              tone === 'cy' && 'border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] text-[var(--cy)]',
              tone === 'warn' &&
                'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]',
            )}
          >
            <Icon className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2 className="truncate text-[15px] font-semibold text-[var(--t-1)]">{title}</h2>
        </div>
        {isEmpty ? <Pill tone="mute">À jour</Pill> : <Pill tone={tone}>{count} en attente</Pill>}
      </header>

      {isEmpty ? (
        <p className="t-cap rounded-card border border-[var(--b-subtle)] bg-[var(--bg-2)] px-4 py-6 text-center text-[var(--t-3)]">
          {emptyLabel}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <HoverLift className="block">
                  <Link
                    href={row.href}
                    prefetch={false}
                    aria-label={row.ariaLabel}
                    className="rounded-card flex items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-3 shadow-[var(--sh-card)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium text-[var(--t-1)]">
                        {row.title}
                      </span>
                      <span className="t-cap truncate text-[var(--t-3)]">{row.meta}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {row.trailing ?? null}
                      <ArrowRight
                        className="h-3.5 w-3.5 text-[var(--t-4)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </div>
                  </Link>
                </HoverLift>
              </li>
            ))}
          </ul>

          <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
            {moreHref ? (
              <Link
                href={moreHref}
                prefetch={false}
                className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
              >
                Voir plus
              </Link>
            ) : null}
            <p className="t-foot text-center text-[var(--t-4)]">
              {typeof shownCount === 'number' ? (
                <>
                  {shownCount} affiché{shownCount > 1 ? 's' : ''} sur{' '}
                  <span className="font-mono tabular-nums">{count} au total</span>
                </>
              ) : null}
            </p>
          </footer>
        </>
      )}
    </Card>
  );
}
