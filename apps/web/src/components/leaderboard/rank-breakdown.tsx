import type { CSSProperties } from 'react';

import { preciseScoreFromParts } from '@/lib/leaderboard/builder';
import type { LeaderboardScore } from '@/lib/leaderboard/types';
import type { SubScore } from '@/lib/scoring/types';

import { PILLARS, type PillarMeta } from './pillar-meta';

/**
 * RankBreakdown — the transparent "pourquoi ce rang ?" panel.
 *
 * Shows the four ACT pillars that build a member's leaderboard score, each with
 * the raw fill bar + the points it contributed (`pointsAwarded / pointsMax`,
 * where `pointsMax` IS its weight: 35 / 30 / 20 / 15). A member can read exactly
 * why they sit where they sit, and what to push to climb, without any P&L ever
 * entering the picture (SPEC §2 / §21.5).
 *
 * Server Component. A `null` pillar (surface not filled yet) is shown as a calm
 * "pas encore mesuré", never a fabricated zero, mirroring the renormalization
 * the builder applies (ADDITION PURE).
 */

function PillarRow({
  meta,
  part,
}: {
  meta: PillarMeta;
  part: SubScore | null;
}): React.ReactElement {
  const filled = part !== null;
  const pct = filled ? Math.round(Math.min(1, Math.max(0, part.rate)) * 100) : 0;
  const weight = filled ? Math.round(part.pointsMax) : null;
  const awarded = filled ? Math.round(part.pointsAwarded) : null;

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--t-1)]">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: filled ? meta.accent : 'var(--t-4)' }}
          />
          {meta.label}
        </span>
        {filled ? (
          <span className="text-[12px] font-medium text-[var(--t-2)] tabular-nums">
            {awarded} / {weight} pts
          </span>
        ) : (
          <span className="text-[11px] text-[var(--t-4)]">pas encore mesuré</span>
        )}
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--bg-3)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${meta.label} : ${filled ? `${pct} pour cent` : 'pas encore mesuré'}`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none"
          style={
            {
              width: `${pct}%`,
              backgroundColor: filled ? meta.accent : 'transparent',
            } as CSSProperties
          }
        />
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--t-3)]">{meta.hint}</p>
    </li>
  );
}

/**
 * French decimal: 84.3 → "84,3". One decimal is enough to make the tie-break
 * legible without pretending to spurious precision.
 */
function formatExact(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function RankBreakdown({ breakdown }: { breakdown: LeaderboardScore }): React.ReactElement {
  // "Score exact" (au détail près) — the full-precision composite the ranking
  // actually sorts on, so a member sees why they sit ahead of someone showing the
  // same rounded score. Only for a RANKED member (status 'ok'): an unranked member
  // has partial pillars but no standing to compare, so we never surface it there.
  const exact =
    breakdown.status === 'ok' && breakdown.score !== null
      ? preciseScoreFromParts(breakdown.parts)
      : null;

  return (
    <div className="flex flex-col gap-3.5">
      <ul className="flex flex-col gap-3.5">
        {PILLARS.map((meta) => (
          <PillarRow key={meta.key} meta={meta} part={breakdown.parts[meta.key]} />
        ))}
      </ul>
      {exact !== null ? (
        <p className="flex items-baseline justify-between gap-2 border-t border-[var(--b-subtle)] pt-3 text-[11px] leading-relaxed text-[var(--t-3)]">
          <span>Score exact, utilisé pour départager les ex æquo</span>
          <span className="shrink-0 font-medium text-[var(--t-2)] tabular-nums">
            {formatExact(exact)} / 100
          </span>
        </p>
      ) : null}
    </div>
  );
}
