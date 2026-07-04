import { Compass } from 'lucide-react';

import {
  coachingAxisLine,
  MENTAL_AXIS_FR,
  type CoachingLinePage,
  type MentalAxis,
} from '@/lib/coaching/mental-map';
import { cn } from '@/lib/utils';

/**
 * CoachingAxisLine (Tour 12, action 4) — a discrete "ton axe de travail" line at
 * the top of routes that were coaching-blind (/patterns, /seances, /library). It
 * reuses the member's dominant mental axis (from their onboarding profile, via
 * `getDominantMentalAxis`) so those pages finally speak to the member instead of
 * being generic surfaces.
 *
 * DETERMINISTIC, ZERO AI: the copy is FIXED per (axis, page) via
 * `coachingAxisLine`, mirroring the frame of `StageAwareLine`. No raw AI text is
 * surfaced → no AIGeneratedBanner (AI Act §50 precedent: stage-aware-line,
 * learning-stage.ts).
 *
 * NULL-SAFE: the page passes `null` when the member has no profile (or none of
 * their priorities maps to an axis) → this renders nothing, never a placeholder
 * and never a fabricated axis. FIREWALL §21.5: an axis is a display-ordering
 * preference, never fed back into a score. POSTURE §2 / Mark Douglas: orienting
 * and calm, never a verdict, never a market call. French, tutoiement, no em-dash.
 *
 * Sobriety: ONE discrete bordered strip (same weight as StageAwareLine), coherent
 * with the page DA, so it adds the personalisation signal without a loud banner.
 */
export function CoachingAxisLine({
  axis,
  page,
  className,
}: {
  axis: MentalAxis | null;
  page: CoachingLinePage;
  /** Optional spacing/layout hook. Rides on the root so it collapses with the
   *  component when `axis` is null (no orphan margin left behind). */
  className?: string;
}) {
  if (!axis) return null;

  return (
    <div
      data-slot="coaching-axis-line"
      data-axis={axis}
      className={cn(
        'rounded-card flex items-start gap-2.5 border border-[var(--b-default)] bg-[var(--bg-2)]/40 px-3.5 py-2.5',
        className,
      )}
    >
      <Compass
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-3)]"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="text-[13px] leading-relaxed text-[var(--t-2)]">
        <span className="font-semibold text-[var(--t-1)]">Axe : {MENTAL_AXIS_FR[axis]}</span>
        <span className="text-[var(--t-3)]"> · </span>
        {coachingAxisLine(axis, page)}
      </p>
    </div>
  );
}
