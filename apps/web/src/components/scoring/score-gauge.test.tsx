// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ScoreGauge } from './score-gauge';

afterEach(cleanup);

/**
 * Tour 15 — onboarding "ramp-up" floor on the score gauge.
 *
 * A low score (< 50) normally reads the red "Critique" band. When `rampUp` is
 * set (member joined < 30 days ago) that bottom band is FLOORED to a calm "En
 * rodage" with an encouraging caption. Only the framing changes — the numeric
 * score, and every other band, is untouched (SPEC §2 / §31.2, never punitive).
 */
describe('ScoreGauge — ramp-up onboarding floor (Tour 15)', () => {
  it('shows red "Critique" for a low score WITHOUT ramp-up', () => {
    render(<ScoreGauge score={32} label="Cohérence" />);
    expect(screen.getByText('Critique')).toBeInTheDocument();
    expect(screen.queryByText('En rodage')).not.toBeInTheDocument();
  });

  it('floors a low score to "En rodage" with the encouraging caption when rampUp', () => {
    render(<ScoreGauge score={32} label="Cohérence" rampUp />);
    expect(screen.getByText('En rodage')).toBeInTheDocument();
    expect(screen.queryByText('Critique')).not.toBeInTheDocument();
    expect(
      screen.getByText('Ta constance se construit. Les 30 premiers jours posent la base.'),
    ).toBeInTheDocument();
  });

  it('reflects "En rodage" in the accessible label (not "Critique")', () => {
    render(<ScoreGauge score={20} label="Discipline" rampUp />);
    // role="img" (no onClick) → aria-label carries the band.
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', 'Discipline : 20 sur 100, En rodage');
  });

  it('does NOT change a mid/high band during ramp-up (only the bottom floor)', () => {
    // 62 → "À renforcer" regardless of ramp-up. No "En rodage", no caption.
    render(<ScoreGauge score={62} label="Stabilité" rampUp />);
    expect(screen.getByText('À renforcer')).toBeInTheDocument();
    expect(screen.queryByText('En rodage')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ta constance se construit/)).not.toBeInTheDocument();
  });

  it('leaves the null/insufficient state unchanged under ramp-up', () => {
    render(<ScoreGauge score={null} label="Engagement" rampUp />);
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.queryByText('En rodage')).not.toBeInTheDocument();
  });
});
