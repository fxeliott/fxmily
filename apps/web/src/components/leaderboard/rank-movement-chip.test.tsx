// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RankMovement } from '@/lib/leaderboard/service';

import { RankMovementChip } from './rank-movement-chip';

/**
 * RankMovementChip — J3 SCOPE 3: a member who HELD a rank and holds none now
 * ("dropped") must SEE it member-side, in the Mark Douglas tone (calm, muted,
 * never alarming red). This is the runtime proof of "Done when" (c): the
 * 'dropped' state renders member-side, and a complacent off-days slip is never
 * masked as a neutral "Stable".
 *
 * The visible label is terse ("Sorti"), so a full sr-only sentence carries the
 * meaning for assistive tech, honest across missed cron nights ("depuis le
 * dernier calcul", never "depuis hier").
 */

afterEach(() => cleanup());

function movement(over: Partial<RankMovement> = {}): RankMovement {
  return { previousRank: 7, delta: 0, direction: 'dropped', ...over };
}

describe('RankMovementChip — dropped state (J3 SCOPE 3)', () => {
  it('renders the dropped signal: terse visible label + full sr-only sentence', () => {
    render(<RankMovementChip movement={movement()} />);

    // Terse visible label (aria-hidden); the sr-only sentence carries the meaning.
    expect(screen.getByText('Sorti')).toBeInTheDocument();
    expect(
      screen.getByText('Tu es sorti du classement depuis le dernier calcul.'),
    ).toBeInTheDocument();
  });

  it('never masks a drop as the neutral "Stable" copy', () => {
    render(<RankMovementChip movement={movement()} />);

    expect(screen.queryByText('Stable')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ta place n'a pas changé/)).not.toBeInTheDocument();
  });

  it('still renders "Stable" for a never-ranked member (same direction, nothing to surface)', () => {
    render(<RankMovementChip movement={{ previousRank: null, delta: 0, direction: 'same' }} />);

    expect(screen.getByText('Stable')).toBeInTheDocument();
    expect(screen.queryByText('Sorti')).not.toBeInTheDocument();
  });
});
