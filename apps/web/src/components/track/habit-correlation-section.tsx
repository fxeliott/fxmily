import { localDateOf } from '@/lib/checkin/timezone';
import {
  buildHabitHeatmap,
  computeHabitTradeCorrelation,
  pairHabitLogsToTrades,
} from '@/lib/analytics/habit-trade-correlation';
import { loadHabitTradeCorrelationData } from '@/lib/habit/service';
import type { HabitKind } from '@/lib/schemas/habit-log';

import { HabitCorrelationCard } from './habit-correlation-card';

/**
 * V2.1.3 — async data section, shared by `/dashboard` and `/track`.
 *
 * Mirrors the J6 `TrackRecordSection` pattern: a Server Component that
 * does its own fetch, wrapped in `<Suspense>` by the host page so the
 * rest of the page streams immediately. The heavy/branching logic is the
 * TDD-tested pure module — this is thin glue (load → pair → compute).
 *
 * Day-1 habit kind is `sleep` (the most-logged + most-documented
 * sleep→performance signal). The architecture generalizes to all 5 kinds
 * with zero restructuring (V2.2).
 */

const HEATMAP_DAYS = 7;

interface HabitCorrelationSectionProps {
  userId: string;
  /** Member timezone (Paris wall-clock anchors the day matching). */
  timezone: string;
  windowDays?: number;
  habitKind?: HabitKind;
}

export async function HabitCorrelationSection({
  userId,
  timezone,
  windowDays = 30,
  habitKind = 'sleep',
}: HabitCorrelationSectionProps) {
  const { habitLogs, trades } = await loadHabitTradeCorrelationData(userId, windowDays);

  const today = localDateOf(new Date(), timezone);
  const pairs = pairHabitLogsToTrades(habitLogs, trades, habitKind, timezone);
  const heatmap = buildHabitHeatmap(habitLogs, today, HEATMAP_DAYS);
  const result = computeHabitTradeCorrelation(pairs, habitKind, windowDays, heatmap);

  return <HabitCorrelationCard result={result} />;
}

/**
 * Structural skeleton mirroring the card chrome + the `sufficient`
 * steady-state layout (header → meta → pill → 240px chart → footnote →
 * heatmap), not a flat rectangle — the J6.6 H2 pattern (sibling
 * `TrackRecordSkeleton`). It matches the steady-state height so CLS is
 * ~0 once a member has data. The `insufficient_data` state is *shorter*
 * (and transient — only the first &lt;8 paired days), so it collapses
 * upward slightly rather than the flat-440 block mismatching all three
 * states (ui-designer review V2.1.3 T1.1).
 */
export function HabitCorrelationSkeleton() {
  return (
    <div
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de la corrélation habitudes × trading"
    >
      <div className="skel h-3 w-48 rounded" />
      <div className="flex flex-col gap-2">
        <div className="skel h-4 w-40 rounded" />
        <div className="skel h-3 w-56 rounded" />
      </div>
      <div className="skel rounded-pill h-5 w-44" />
      <div className="skel rounded-card-lg h-[240px] w-full" />
      <div className="skel h-3 w-full rounded" />
      <div className="border-t border-[var(--b-default)] pt-4">
        <div className="skel h-[148px] w-full rounded" />
      </div>
    </div>
  );
}
