import { cn } from '@/lib/utils';

/**
 * SSR-safe skeleton matching MindsetDashboard layout — Lecture/Radar/Trends
 * sections at full dimensions to prevent CLS while Recharts lazy-loads.
 */
export function MindsetDashboardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="mindset-dashboard-skeleton"
      className={cn('flex flex-col gap-4', className)}
    >
      {/* Lecture de la semaine */}
      <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="skel h-3 w-32" />
          <div className="skel h-3 w-24" />
        </div>
        <div className="skel h-3 w-3/4 max-w-[320px]" />
        <div className="skel h-3 w-2/3 max-w-[260px]" />
      </section>
      {/* Radar */}
      <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <div className="skel h-3 w-40" />
        <div className="skel h-[300px] w-full" />
      </section>
      {/* Dimension trends */}
      <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="skel h-3 w-36" />
          <div className="skel h-3 w-24" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="skel h-3 w-20" />
                <div className="skel h-3 w-12" />
              </div>
              <div className="skel h-[88px] w-full" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
