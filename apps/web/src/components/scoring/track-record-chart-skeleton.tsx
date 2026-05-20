import { cn } from '@/lib/utils';

/**
 * SSR-safe skeleton matching TrackRecordChart layout — same h-[260px]
 * inner figure + same card chrome to prevent CLS while the Recharts
 * chunk lazy-loads. Uses DS-v2 `.skel` (calm shimmer 1.4s, Mark Douglas
 * canon — never a pulse strobe).
 */
export function TrackRecordChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="track-record-chart-skeleton"
      className={cn(
        'rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="skel h-3 w-24" />
        <div className="flex items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skel rounded-pill h-8 w-12" />
          ))}
        </div>
      </div>
      <div className="skel h-[260px] w-full" />
    </div>
  );
}
