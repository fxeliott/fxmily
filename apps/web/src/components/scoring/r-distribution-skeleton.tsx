import { cn } from '@/lib/utils';

/**
 * SSR-safe skeleton matching RDistribution layout — same h-[200px] figure
 * + same card chrome to prevent CLS during Recharts chunk lazy-load.
 */
export function RDistributionSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="r-distribution-skeleton"
      className={cn(
        'rounded-card-lg flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="skel h-3 w-28" />
        <div className="skel h-3 w-16" />
      </div>
      <div className="skel h-[200px] w-full" />
    </div>
  );
}
