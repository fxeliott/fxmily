import type { CSSProperties } from 'react';

import type { LeaderboardParts, LeaderboardScore } from '@/lib/leaderboard/types';
import type { SubScore } from '@/lib/scoring/types';

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

interface PillarMeta {
  key: keyof LeaderboardParts;
  label: string;
  hint: string;
  /** Non-text accent (bar fill / dot) along the neutral data-viz spectrum. */
  accent: string;
}

const PILLARS: PillarMeta[] = [
  {
    key: 'assiduity',
    label: 'Assiduité',
    hint: 'Ta présence et tes connexions au quotidien',
    accent: 'var(--dv-1)',
  },
  {
    key: 'discipline',
    label: 'Discipline',
    hint: 'Le respect de ton plan et de ton process',
    accent: 'var(--dv-2)',
  },
  {
    key: 'regularity',
    label: 'Régularité',
    hint: 'Ton rythme tenu dans la durée, absences justifiées comprises',
    accent: 'var(--dv-3)',
  },
  {
    key: 'work',
    label: 'Travail de suivi',
    hint: 'La profondeur de ton suivi personnel',
    accent: 'var(--acc-hi)',
  },
];

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

export function RankBreakdown({ breakdown }: { breakdown: LeaderboardScore }): React.ReactElement {
  return (
    <ul className="flex flex-col gap-3.5">
      {PILLARS.map((meta) => (
        <PillarRow key={meta.key} meta={meta} part={breakdown.parts[meta.key]} />
      ))}
    </ul>
  );
}
