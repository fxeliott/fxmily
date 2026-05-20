import { cn } from '@/lib/utils';

/**
 * SSR-safe skeleton matching TrainingDebriefStatsPanel layout (4 process
 * families). Same card chrome + matching section dims to prevent CLS
 * while Recharts lazy-loads.
 */
export function TrainingDebriefStatsPanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="training-debrief-stats-skeleton"
      className={cn(
        'rounded-card-lg flex flex-col gap-5 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="skel h-3 w-32" />
        <div className="skel h-3 w-28" />
      </div>
      {/* Famille 1 — Volume & régularité */}
      <section className="flex flex-col gap-2">
        <div className="skel h-4 w-40" />
        <div className="skel h-[150px] w-full" />
        <div className="skel h-3 w-3/4" />
      </section>
      {/* Famille 2 — Respect du système */}
      <section className="flex flex-col gap-2">
        <div className="skel h-4 w-44" />
        <div className="skel h-[120px] w-full" />
        <div className="skel h-3 w-2/3" />
      </section>
      {/* Famille 3 — Diversité de pratique */}
      <section className="flex flex-col gap-2">
        <div className="skel h-4 w-40" />
        <div className="skel h-8 w-1/2" />
      </section>
      {/* Famille 4 — Leçons & corrections */}
      <section className="flex flex-col gap-2">
        <div className="skel h-4 w-44" />
        <div className="grid grid-cols-2 gap-3">
          <div className="skel h-20 w-full" />
          <div className="skel h-20 w-full" />
        </div>
      </section>
    </div>
  );
}
