// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExpectancyResult } from '@/lib/analytics';

import { ExpectancyCard } from './expectancy-card';

afterEach(cleanup);

/**
 * Guards the French-copy harmonization on the scoring surfaces: absent
 * metrics render « non calculé » (aligned with score-trend-chart), never the
 * « N/A » anglicism. Locks the fix so a regression fails loudly.
 */
const RESULT = (over: Partial<ExpectancyResult> = {}): ExpectancyResult => ({
  expectancyR: 0.8,
  profitFactor: 3,
  avgWinR: 1.2,
  avgLossR: -0.6,
  payoffRatio: 2,
  winRate: 0.6,
  lossRate: 0.4,
  breakEvenRate: 0,
  sampleSize: {
    closedTrades: 25,
    computedTrades: 25,
    estimatedTrades: 0,
    excludedFromExpectancy: 0,
    sufficientSample: true,
  },
  ...over,
});

describe('ExpectancyCard — copy « non calculé » (harmonisation scoring)', () => {
  it('rend « non calculé » quand le payoff R:R est indisponible, jamais « N/A »', () => {
    const { container } = render(<ExpectancyCard expectancy={RESULT({ payoffRatio: null })} />);
    expect(screen.getByText('non calculé')).toBeInTheDocument();
    expect(container.textContent).not.toContain('N/A');
  });

  it('rend « non calculé » pour expectancy et profit factor absents (grille rendue)', () => {
    // A closed-but-uncomputable sample: metrics grid shows, expectancy +
    // profit factor are null. `expectancyR !== null` keeps us out of the
    // insufficient-sample branch so the null formatters are exercised.
    const { container } = render(
      <ExpectancyCard
        expectancy={RESULT({ expectancyR: 0, profitFactor: null, payoffRatio: null })}
      />,
    );
    expect(screen.getAllByText('non calculé').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('N/A');
  });

  it('rend les valeurs chiffrées normalement quand tout est calculé', () => {
    const { container } = render(<ExpectancyCard expectancy={RESULT()} />);
    expect(container.textContent).toContain('1:2.00');
    expect(container.textContent).not.toContain('non calculé');
    expect(container.textContent).not.toContain('N/A');
  });
});
