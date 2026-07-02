import { ArrowRight, Compass } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import type { ProcessObjectivesView } from '@/lib/objectives/service';
import { cn } from '@/lib/utils';

/**
 * S19 — "Ta progression" bridge card on the dashboard hub.
 *
 * Closes the orientation gap (Eliott S19: "savoir OÙ j'en suis / OÙ je vais / sur
 * quoi bosser"). The journey tier / ETA / focus lever lived ONLY on /objectifs;
 * this surfaces them on the most-seen page and bridges to the full roadmap. It
 * shows, at a glance:
 *   - WHERE globally: the cap tier (Découverte → Maîtrise) + a 4-segment rail;
 *   - WHERE heading: a calm ETA ("Maîtrise en ~N semaines"), never a promise;
 *   - WHAT to work on: the lowest dimension (focus lever).
 *
 * Presentational only — the view is derived once on the page. Posture §2 /
 * anti-Black-Hat: a tendency not a verdict, no red, no pressure, no countdown.
 * Renders nothing before the member has scores (no fabricated state — the
 * first-run welcome owns that moment).
 */
export function DashboardProgressBridge({ view }: { view: ProcessObjectivesView }) {
  const { capTier, journey, focus, trajectory, hasScores } = view;
  if (!hasScores) return null;

  const etaLabel = trajectory.etaLabel;

  return (
    <HoverLift className="block">
      <Link
        href="/objectifs"
        data-slot="dashboard-progress-bridge"
        className="wow-hover-glow rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-4 transition-colors hover:bg-[var(--acc-dim)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Compass className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="t-eyebrow text-[var(--acc-hi)]">Ta progression</span>
              <p className="text-[15px] font-semibold text-[var(--t-1)]">Palier {capTier.label}</p>
            </div>
          </div>
          <ArrowRight
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--t-3)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </div>

        {/* 4-segment journey rail (Découverte → Maîtrise). Reached = accent,
            current = accent + glow, future = muted. Decorative; the labels below
            carry the meaning for SR. */}
        <ol
          className="mt-3.5 flex items-center gap-1.5"
          aria-label={`Parcours : palier ${capTier.label}`}
        >
          {journey.map((stage) => (
            <li
              key={stage.id}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                stage.current
                  ? 'bg-[var(--acc)] shadow-[var(--acc-glow)]'
                  : stage.reached
                    ? 'bg-[var(--acc)]/70'
                    : 'bg-[var(--b-strong)]',
              )}
            >
              <span className="sr-only">
                {stage.label}
                {stage.current ? ' (étape actuelle)' : stage.reached ? ' (atteint)' : ''}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {focus ? (
            <p className="t-cap text-[var(--t-2)]">
              Sur quoi bosser :{' '}
              <strong className="font-semibold text-[var(--t-1)]">{focus.label}</strong>
              <span className="text-[var(--t-3)]"> · {focus.hint}</span>
            </p>
          ) : (
            <p className="t-cap text-[var(--t-2)]">Toutes tes dimensions tiennent le cap.</p>
          )}
          {etaLabel ? (
            <span className="t-cap shrink-0 text-[var(--t-3)] tabular-nums">{etaLabel}</span>
          ) : null}
        </div>
      </Link>
    </HoverLift>
  );
}
