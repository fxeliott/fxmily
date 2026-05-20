/**
 * SSR-safe skeleton matching HabitCorrelationScatter dimensions — same
 * h-[240px] figure to prevent CLS while Recharts lazy-loads. Parent
 * `<HabitCorrelationCard>` already provides the card chrome.
 */
export function HabitCorrelationScatterSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-slot="habit-correlation-scatter-skeleton"
      className="skel h-[240px] w-full"
    />
  );
}
