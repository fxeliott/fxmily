// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecentBackfillDay } from '@/lib/checkin/service';

import { CatchUpRecentCue } from './catch-up-recent-cue';

afterEach(() => {
  cleanup();
});

// jsdom env startup can spike past 5s on cold Windows filesystem — bump timeout.
vi.setConfig({ testTimeout: 15000 });

/**
 * Tour 15 — the multi-day hub « Rattrapage » cue. Pins: one catch-up link per
 * missing slot PER listed day, each carrying `?date=<day>` so the wizard opens
 * in rattrapage mode; calm copy that adapts to one vs. several days.
 */
describe('CatchUpRecentCue', () => {
  const day = (over: Partial<RecentBackfillDay> = {}): RecentBackfillDay => ({
    date: '2026-06-09',
    morningMissing: true,
    eveningMissing: true,
    ...over,
  });

  it('renders a link per missing slot for a single day with its ?date= param', () => {
    render(<CatchUpRecentCue days={[day()]} />);
    const morning = screen.getByRole('link', { name: /Rattraper le matin/ });
    const evening = screen.getByRole('link', { name: /Rattraper la soirée/ });
    expect(morning).toHaveAttribute('href', '/checkin/morning?date=2026-06-09');
    expect(evening).toHaveAttribute('href', '/checkin/evening?date=2026-06-09');
  });

  it('lists several days, each with its own dated links', () => {
    render(
      <CatchUpRecentCue
        days={[
          day({ date: '2026-06-09', morningMissing: true, eveningMissing: false }),
          day({ date: '2026-06-05', morningMissing: false, eveningMissing: true }),
        ]}
      />,
    );
    // Day 1: only the morning link, dated 06-09.
    expect(screen.getByRole('link', { name: /Rattraper le matin/ })).toHaveAttribute(
      'href',
      '/checkin/morning?date=2026-06-09',
    );
    // Day 2: only the evening link, dated 06-05.
    expect(screen.getByRole('link', { name: /Rattraper la soirée/ })).toHaveAttribute(
      'href',
      '/checkin/evening?date=2026-06-05',
    );
    // Plural copy mentions the day count.
    expect(screen.getByText(/2 jours à compléter/)).toBeInTheDocument();
  });

  it('uses the singular copy for exactly one day', () => {
    render(<CatchUpRecentCue days={[day()]} />);
    expect(screen.getByText(/un jour à compléter/)).toBeInTheDocument();
  });

  it('shows only the missing slot when one is already filled', () => {
    render(<CatchUpRecentCue days={[day({ morningMissing: true, eveningMissing: false })]} />);
    expect(screen.getByRole('link', { name: /Rattraper le matin/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rattraper la soirée/ })).toBeNull();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<CatchUpRecentCue days={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
