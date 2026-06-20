// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreakCard } from './streak-card';

// `vitest.config.ts` has `globals: false`, so @testing-library/react auto-cleanup
// doesn't register on `afterEach`. Wire it manually so each render() starts clean.
afterEach(() => {
  cleanup();
});

// jsdom env startup can spike past 5s on cold Windows filesystem — bump timeout.
vi.setConfig({ testTimeout: 15000 });

/**
 * S11 — the dashboard compact streak strip now carries the calm "palier franchi"
 * acknowledgement too (previously full-card only). These tests pin the
 * branch so a future refactor can't silently drop the milestone settle or turn
 * it into a recurring fanfare (anti-Black-Hat §31.2: one-time, calm, never a nag).
 */

describe('StreakCard — compact milestone celebration (S11)', () => {
  it('celebrates in the compact variant when justCrossed === streak', () => {
    const { container } = render(<StreakCard streak={7} todayFilled justCrossed={7} compact />);
    // Visible calm acknowledgement (lowercase pill copy in the compact strip).
    expect(screen.getByText('palier 7 j franchi')).toBeInTheDocument();
    // Accessible, non-visual confirmation for AT users.
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Palier de 7 jours franchi/);
    // One-time calm halo on the flame (compositor-only, then stops).
    expect(container.querySelector('.celebrate-halo')).not.toBeNull();
  });

  it('does NOT celebrate compact when no milestone was just crossed', () => {
    render(<StreakCard streak={7} todayFilled justCrossed={null} compact />);
    expect(screen.getByText('consécutifs')).toBeInTheDocument();
    expect(screen.queryByText(/palier .* franchi/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does NOT celebrate compact when justCrossed is stale (≠ current streak)', () => {
    // Defence against stale props: a 7-day pill must never show at streak 8.
    const { container } = render(<StreakCard streak={8} todayFilled justCrossed={7} compact />);
    expect(screen.queryByText(/palier .* franchi/i)).toBeNull();
    expect(container.querySelector('.celebrate-halo')).toBeNull();
  });

  it('shows "à confirmer aujourd’hui" when the streak is not filled today', () => {
    render(<StreakCard streak={5} todayFilled={false} compact />);
    expect(screen.getByText('à confirmer aujourd’hui')).toBeInTheDocument();
  });
});

describe('StreakCard — full variant celebration (regression)', () => {
  it('still renders the "Palier N j franchi" pill on the full card', () => {
    render(<StreakCard streak={14} todayFilled justCrossed={14} />);
    expect(screen.getByText('Palier 14 j franchi')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/Palier de 14 jours franchi/);
  });
});
