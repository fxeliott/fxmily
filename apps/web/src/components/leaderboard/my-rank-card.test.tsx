// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { LeaderboardRowView } from '@/lib/leaderboard/service';
import type { LeaderboardParts } from '@/lib/leaderboard/types';
import type { SubScore } from '@/lib/scoring/types';

import { MyRankCard } from './my-rank-card';

/**
 * MyRankCard — the low-score ALERT must never fire for a podium member.
 *
 * Review finding (n1/n3): a small or early board can leave the rank-1 member
 * below the low-score threshold. Before the fix the card rendered the podium
 * reinforcement AND the ambre "ton score est bas" alert at once — two
 * contradictory messages. The gate is now `isLowScore(...) && !onPodium`, so a
 * podium member is reinforced, everyone else genuinely low is alerted. These
 * tests pin that contract at the render level (the `AskUserQuestion`-free proof
 * the runtime page can't produce, since the demo member is not low).
 */

const sub = (rate: number): SubScore => ({
  rate,
  pointsAwarded: rate * 30,
  pointsMax: 30,
  numerator: 0,
  denominator: 0,
});

// Assiduité is the weakest pillar here → the personalized lever, when shown.
const PARTS: LeaderboardParts = {
  assiduity: sub(0.2),
  discipline: sub(0.4),
  regularity: sub(0.5),
  work: sub(0.3),
};

function row(over: Partial<LeaderboardRowView> = {}): LeaderboardRowView {
  return {
    userId: 'u1',
    rank: 1,
    score: 28,
    firstName: 'Alex',
    avatarUrl: null,
    initials: 'AL',
    isViewer: true,
    status: 'ok',
    breakdown: { score: 28, status: 'ok', parts: PARTS, sample: { sufficient: true } },
    activeDays: 7,
    minActiveDays: 7,
    ...over,
  };
}

const LOW_ALERT = /ton score de travail est bas/i;
const PODIUM_LINE = /tu es dans le top 3/i;

afterEach(() => cleanup());

describe('MyRankCard — low-score alert vs podium', () => {
  it('does NOT alert a podium member with a low score (no contradiction)', () => {
    // rank 1 + score 28: low by threshold, but on the podium → reinforced, not alerted.
    render(<MyRankCard me={row({ rank: 1, score: 28 })} totalRanked={4} thirdScore={20} />);

    expect(screen.queryByText(LOW_ALERT)).toBeNull();
    expect(screen.getByText(PODIUM_LINE)).toBeTruthy();
  });

  it('DOES alert a genuinely low, non-podium member', () => {
    // rank 8 + score 28: off the podium and below threshold → the calm ambre alert.
    render(<MyRankCard me={row({ rank: 8, score: 28 })} totalRanked={20} thirdScore={60} />);

    expect(screen.getByText(LOW_ALERT)).toBeTruthy();
    // The motivation line is suppressed — the alert already carries the next step.
    expect(screen.queryByText(PODIUM_LINE)).toBeNull();
  });

  it('reinforces a podium member with a healthy score (no alert either)', () => {
    render(<MyRankCard me={row({ rank: 1, score: 92 })} totalRanked={12} thirdScore={70} />);

    expect(screen.queryByText(LOW_ALERT)).toBeNull();
    expect(screen.getByText(PODIUM_LINE)).toBeTruthy();
  });
});

describe('MyRankCard — honest gap to the podium', () => {
  // Members are ranked on the FULL-PRECISION composite, but the card shows the
  // ROUNDED score. So an off-podium member can share the rounded score of the
  // 3rd place (84.2 and 84.4 both display 84), or lose the podium on a tie-break.
  it('never shows "il te manque 0 point" when the rounded gap is zero (off-podium)', () => {
    // rank 4, score 60 == thirdScore 60: strictly behind on precision, tied on
    // the displayed integer, and well above the low-score threshold.
    const { container } = render(
      <MyRankCard me={row({ rank: 4, score: 60 })} totalRanked={10} thirdScore={60} />,
    );

    expect(container.textContent).not.toMatch(/te manque\s*0\s*point/i);
    // Falls through to the truthful generic encouragement instead.
    expect(container.textContent).toMatch(/pour grimper dans le classement/i);
  });

  it('shows the honest positive gap when the member is genuinely behind', () => {
    const { container } = render(
      <MyRankCard me={row({ rank: 4, score: 60 })} totalRanked={10} thirdScore={70} />,
    );

    expect(container.textContent).toMatch(/te manque\s*10\s*points/i);
    expect(container.textContent).toMatch(/pour entrer dans le top 3/i);
  });
});

describe('MyRankCard — qualification counter (SCOPE 2)', () => {
  // A not-yet-ranked member (rank null) sees the exact "X/N jours actifs — il
  // t'en reste M" counter instead of the vague old copy. N is the REAL gate
  // threshold applied to them (may shrink below 7 with justified off-days).
  it('shows the exact "X/N jours actifs — il t\'en reste M" counter', () => {
    const { container } = render(
      <MyRankCard
        me={row({ rank: null, score: null, activeDays: 3, minActiveDays: 7 })}
        totalRanked={0}
        thirdScore={null}
      />,
    );

    expect(container.textContent).toMatch(/3\/7\s*jours actifs/i);
    expect(container.textContent).toMatch(/il t'en reste\s*4/i);
    // Never P&L on the surface (firewall §21.5): the reassurance stays behavioral.
    expect(container.textContent).toMatch(/pas tes résultats de trading/i);
  });

  it('drops the "il t\'en reste" clause once the member has reached the gate', () => {
    const { container } = render(
      <MyRankCard
        me={row({ rank: null, score: null, activeDays: 7, minActiveDays: 7 })}
        totalRanked={0}
        thirdScore={null}
      />,
    );

    expect(container.textContent).toMatch(/7\/7\s*jours actifs/i);
    expect(container.textContent).not.toMatch(/il t'en reste/i);
    expect(container.textContent).toMatch(/ton rang se calcule cette nuit/i);
  });

  it('falls back to the generic copy when the counter data is unavailable', () => {
    // Pre-foundation snapshots (or a non-viewer edge) leave the fields null →
    // the card must never render "null/7", it shows the calm generic line.
    const { container } = render(
      <MyRankCard
        me={row({ rank: null, score: null, activeDays: null, minActiveDays: null })}
        totalRanked={0}
        thirdScore={null}
      />,
    );

    expect(container.textContent).not.toMatch(/null/i);
    expect(container.textContent).toMatch(/encore quelques jours de check-ins/i);
  });
});
