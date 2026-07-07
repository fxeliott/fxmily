import { Crown, Medal } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { LeaderboardRowView } from '@/lib/leaderboard/service';

import { AnimatedNumber } from '../ui/animated-number';
import { Avatar } from '../ui/avatar';
import { HoverLift } from '../ui/hover-lift';

/**
 * Podium — the top three members, rendered STRICTLY hierarchically
 * (1 > 2 > 3). The first place is the biggest (larger avatar, taller pedestal,
 * the brightest accent + a crown); second and third step down in size and in
 * hue along the NEUTRAL data-viz spectrum (`--dv-*`), never the P&L
 * green/red (`--ok`/`--bad`), because a rank here rewards the ACT of working,
 * not a trade result (SPEC §2 / §21.5).
 *
 * Layout: a single source order (1, 2, 3) so mobile reads top-to-bottom in
 * rank order; at `sm+` the flex row reorders to the classic 2 · 1 · 3 podium
 * with `items-end`, and the per-place bottom padding lifts first place above
 * the others. One JSX tree, animation carried by CSS (`wow-rise` +
 * `--rise-delay`) so `prefers-reduced-motion` is honored without a branch.
 */

interface PlaceConfig {
  avatar: number;
  Icon: typeof Crown;
  /** Non-text accent (borders / tints / icon / ghost numeral) — decorative, AA-exempt. */
  accent: string;
  dim: string;
  edge: string;
  /**
   * Rank-badge fill + foreground. This pair backs the VISIBLE rank numeral, so
   * it is real text and MUST clear WCAG 1.4.3 AA (4.5:1) in the default dark
   * theme — the raw `accent` fills do NOT (blue 3.48:1, cyan 1.71:1 under white).
   * Chosen per place: place 1 darkens the blue to `--acc-btn` (4.97:1 white),
   * place 2 indigo keeps white (4.78:1), place 3 flips the bright cyan to a
   * near-black `--bg` foreground (~10:1). Verified per place, both themes.
   */
  badgeBg: string;
  badgeText: string;
  /** sm+ pedestal lift + entrance order. */
  orderClass: string;
  padClass: string;
  riseDelay: string;
}

/** Visual tier per place — crown/size/hue/pedestal only. The DISPLAYED rank
 * number + label are driven by the member's real `row.rank`, never by this
 * styling tier, so they can never diverge from the member's true standing. */
const PLACES: Record<1 | 2 | 3, PlaceConfig> = {
  1: {
    avatar: 96,
    Icon: Crown,
    accent: 'var(--acc)',
    dim: 'var(--acc-dim)',
    edge: 'var(--b-acc)',
    badgeBg: 'var(--acc-btn)',
    badgeText: 'var(--acc-fg)',
    orderClass: 'sm:order-2',
    padClass: 'sm:pb-9',
    riseDelay: '60ms',
  },
  2: {
    avatar: 76,
    Icon: Medal,
    accent: 'var(--dv-2)',
    dim: 'var(--dv-2-dim)',
    edge: 'var(--dv-2-edge)',
    badgeBg: 'var(--dv-2)',
    badgeText: 'var(--acc-fg)',
    orderClass: 'sm:order-1',
    padClass: 'sm:pb-4',
    riseDelay: '0ms',
  },
  3: {
    avatar: 68,
    Icon: Medal,
    accent: 'var(--dv-3)',
    dim: 'var(--dv-3-dim)',
    edge: 'var(--dv-3-edge)',
    badgeBg: 'var(--dv-3)',
    badgeText: 'var(--bg)',
    orderClass: 'sm:order-3',
    padClass: 'sm:pb-1',
    riseDelay: '120ms',
  },
};

/** French podium label from a real rank: 1 → "1re place", else "Ne place". */
function placeLabel(rank: number): string {
  return `${rank}${rank === 1 ? 're' : 'e'} place`;
}

function PodiumStep({
  row,
  place,
}: {
  row: LeaderboardRowView;
  place: 1 | 2 | 3;
}): React.ReactElement {
  const cfg = PLACES[place];
  // Displayed rank is the member's REAL rank, not the styling tier (`place`), so
  // the numeral + label always match their true standing (the podium is only ever
  // fed members whose real rank === place, but this keeps it structurally honest).
  const displayRank = row.rank ?? place;
  return (
    <HoverLift className={`block flex-1 ${cfg.orderClass}`}>
      <div
        className={`wow-rise rounded-card-lg card-premium relative flex flex-col items-center gap-3 border bg-[var(--bg-1)] px-4 pt-6 pb-5 text-center shadow-[var(--sh-card)] ${cfg.padClass}`}
        style={
          {
            borderColor: cfg.edge,
            '--rise-delay': cfg.riseDelay,
          } as CSSProperties
        }
      >
        {/* Ghost rank numeral behind the avatar (depth, decorative). */}
        <span
          aria-hidden="true"
          className="f-display pointer-events-none absolute top-2 right-3 text-[44px] leading-none font-bold opacity-10 select-none"
          style={{ color: cfg.accent }}
        >
          {displayRank}
        </span>

        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-full"
          style={{ backgroundColor: cfg.dim, color: cfg.accent }}
        >
          <cfg.Icon className="h-4 w-4" strokeWidth={2} />
        </span>

        <div className="relative">
          <Avatar
            url={row.avatarUrl}
            initials={row.initials}
            firstName={row.firstName}
            size={cfg.avatar}
            ring={row.isViewer}
          />
          <span
            aria-hidden="true"
            className="f-display absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--bg-1)] text-[12px] font-bold"
            style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
          >
            {displayRank}
          </span>
        </div>

        <div className="flex max-w-full flex-col items-center gap-0.5">
          {/* The " (toi)" marker sits OUTSIDE the truncating span so a long first
              name can never clip the self-cue; `title` exposes the full name. */}
          <p className="flex max-w-full items-baseline justify-center gap-1 text-[15px] font-semibold text-[var(--t-1)]">
            <span className="max-w-[12ch] truncate" title={row.firstName ?? undefined}>
              {row.firstName}
            </span>
            {row.isViewer ? <span className="shrink-0 text-[var(--t-3)]">(toi)</span> : null}
          </p>
          <span className="t-eyebrow text-[var(--t-3)]">{placeLabel(displayRank)}</span>
        </div>

        <div className="flex items-baseline gap-1">
          <AnimatedNumber
            value={row.score ?? 0}
            className="f-display text-[26px] leading-none font-bold text-[var(--t-1)]"
          />
          <span className="text-[13px] font-medium text-[var(--t-3)]">/100</span>
        </div>
      </div>
    </HoverLift>
  );
}

export function Podium({ top }: { top: LeaderboardRowView[] }): React.ReactElement {
  // Place each member by their TRUE rank (1/2/3), NEVER by array position. When a
  // top-3 member opts out they are absent from `top`, so a positional read would
  // promote the next member into an empty slot and mislabel their rank. Selecting
  // by real rank keeps the missing step absent and every remaining member at their
  // honest standing (consistent with the list + MyRankCard). A short board (only 1
  // or 2 ranked members) renders the same way: only the present places show.
  const byRank = (r: 1 | 2 | 3): LeaderboardRowView | null =>
    top.find((row) => row.rank === r) ?? null;
  const first = byRank(1);
  const second = byRank(2);
  const third = byRank(3);

  return (
    <section aria-label="Podium des trois premiers" className="mb-8">
      {/* DOM order is 1 · 2 · 3 so mobile (flex-col) reads top-to-bottom in RANK
          order — the winner is first, honoring "le 1 plus que le 2". At sm+ the
          per-place `sm:order-*` classes reflow to the classic 2 · 1 · 3 podium
          (first place centered), so the visual hierarchy holds on both axes. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        {first ? <PodiumStep row={first} place={1} /> : null}
        {second ? <PodiumStep row={second} place={2} /> : null}
        {third ? <PodiumStep row={third} place={3} /> : null}
      </div>
      {/* A calm nudge to climb — motivation without FOMO (SPEC §2). */}
      <p className="mt-4 text-center text-[12px] text-[var(--t-3)]">
        Le classement récompense ton travail et ta régularité, jamais tes gains.{' '}
        <Link
          href="/checkin"
          className="font-medium text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
        >
          Fais ton check-in du jour
        </Link>{' '}
        pour grimper.
      </p>
    </section>
  );
}
