// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatchUpYesterdayCue } from './catch-up-yesterday-cue';

afterEach(() => {
  cleanup();
});

// jsdom env startup can spike past 5s on cold Windows filesystem — bump timeout.
vi.setConfig({ testTimeout: 15000 });

/**
 * F7 Layer 3 — the hub « Rattraper hier » cue. Pins: one catch-up link per
 * missing slot, each carrying `?date=<yesterday>` so the wizard opens in
 * rattrapage mode.
 */
describe('CatchUpYesterdayCue', () => {
  it('renders one link per missing slot with the ?date= param', () => {
    render(<CatchUpYesterdayCue date="2026-06-09" morningMissing eveningMissing />);
    const morning = screen.getByRole('link', { name: /Rattraper le matin/ });
    const evening = screen.getByRole('link', { name: /Rattraper la soirée/ });
    expect(morning).toHaveAttribute('href', '/checkin/morning?date=2026-06-09');
    expect(evening).toHaveAttribute('href', '/checkin/evening?date=2026-06-09');
  });

  it('shows only the morning link when only the morning is missing', () => {
    render(<CatchUpYesterdayCue date="2026-06-09" morningMissing eveningMissing={false} />);
    expect(screen.getByRole('link', { name: /Rattraper le matin/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rattraper la soirée/ })).toBeNull();
  });

  it('shows only the evening link when only the evening is missing', () => {
    render(<CatchUpYesterdayCue date="2026-06-09" morningMissing={false} eveningMissing />);
    expect(screen.getByRole('link', { name: /Rattraper la soirée/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rattraper le matin/ })).toBeNull();
  });
});
