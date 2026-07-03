// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { JourneyMilestone } from '@/lib/coaching/journey-milestone';

import { JourneyMilestoneBanner } from './journey-milestone-banner';

afterEach(() => {
  cleanup();
});

/**
 * Tour 11 — pins the process milestone banner: it names the milestone, exposes an
 * AT status region, and is dismissible. Anti-Black-Hat (§31.2): process over
 * outcome copy, no trophy/FOMO, no shouting.
 */
const TRADES: JourneyMilestone = {
  kind: 'trades',
  value: 25,
  eyebrow: 'Jalon de parcours',
  title: '25 trades journalisés',
  body: "25 trades journalisés. Ce n'est pas le nombre qui compte, c'est la trace que tu construis, trade après trade.",
};

const MONTH: JourneyMilestone = {
  kind: 'first-month',
  value: 30,
  eyebrow: 'Jalon de parcours',
  title: 'Ton premier mois de présence',
  body: "Un mois que tu tiens ton suivi. La régularité s'installe : c'est elle, pas un résultat, qui construit ton edge.",
};

describe('JourneyMilestoneBanner', () => {
  it('names the milestone and exposes an accessible status', () => {
    render(<JourneyMilestoneBanner milestone={TRADES} />);
    expect(screen.getByText('25 trades journalisés')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/25 trades journalisés/);
  });

  it('renders the month milestone with its own copy', () => {
    render(<JourneyMilestoneBanner milestone={MONTH} />);
    expect(screen.getByText('Ton premier mois de présence')).toBeInTheDocument();
  });

  it('uses calm, process-focused copy (anti-Black-Hat §31.2)', () => {
    const { container } = render(<JourneyMilestoneBanner milestone={TRADES} />);
    const text = container.textContent || '';
    expect(text).toMatch(/trace/);
    // No shouting fanfare, no em-dash.
    expect(text).not.toContain('!');
    expect(text).not.toContain('—');
  });

  it('is dismissible', () => {
    render(<JourneyMilestoneBanner milestone={TRADES} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fermer le message de jalon/ }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
