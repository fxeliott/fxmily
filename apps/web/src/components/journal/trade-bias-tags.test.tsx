// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TradeBiasTags } from './trade-bias-tags';

/**
 * Tour 11 finding 3 — restitution of REFLECT bias tags on the trade detail.
 * Presentational: assert the filtering (known slugs only, no fabricated empty
 * state) and the tone grammar (discipline-high = ok, biases = neutral, no red).
 */

afterEach(cleanup);

describe('TradeBiasTags', () => {
  it('renders nothing when there are no tags (no fabricated empty state)', () => {
    const { container } = render(<TradeBiasTags tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when every tag is an unknown/legacy slug', () => {
    const { container } = render(<TradeBiasTags tags={['tilt', 'fomo', 'garbage']} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the FR label for a known bias tag as a neutral pill', () => {
    render(<TradeBiasTags tags={['loss-aversion']} />);
    const pill = screen.getByText('Aversion à la perte');
    expect(pill).toBeInTheDocument();
    // Bias tags are neutral (mute) — never the bad/red tone.
    expect(pill.closest('[data-slot="pill"]')?.getAttribute('data-tone')).toBe('mute');
  });

  it('renders discipline-high as the only strengths-based ok tone', () => {
    render(<TradeBiasTags tags={['discipline-high']} />);
    const pill = screen.getByText('Discipline solide');
    expect(pill.closest('[data-slot="pill"]')?.getAttribute('data-tone')).toBe('ok');
  });

  it('keeps only the known slugs out of a mixed list', () => {
    render(<TradeBiasTags tags={['revenge-trade', 'tilt', 'discipline-high']} />);
    expect(screen.getByText('Revenge trade')).toBeInTheDocument();
    expect(screen.getByText('Discipline solide')).toBeInTheDocument();
    expect(screen.queryByText('tilt')).toBeNull();
  });
});
