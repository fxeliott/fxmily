// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RealityVsDeclared } from './reality-vs-declared';

afterEach(cleanup);

const DECLARED = {
  pair: 'EURUSD',
  direction: 'long' as const,
  lotSize: 0.5,
  enteredAt: new Date('2026-06-20T09:30:00.000Z'),
};
const REALITY = {
  symbol: 'GBPUSD',
  side: 'short' as const,
  volume: 1.25,
  openTime: new Date('2026-06-20T11:00:00.000Z'),
  pnl: 50,
};

describe('RealityVsDeclared — face-à-face « Réalité vs Déclaré » (DoD §33)', () => {
  it('mismatch : les DEUX côtés posés ligne par ligne', () => {
    render(<RealityVsDeclared declared={DECLARED} reality={REALITY} />);
    expect(screen.getByText('Ce que tu as déclaré')).toBeInTheDocument();
    expect(screen.getByText('Ce que ton historique montre')).toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.getByText('GBPUSD')).toBeInTheDocument();
    // P&L only shown on the reality side, signed.
    expect(screen.getByText('+50')).toBeInTheDocument();
  });

  it('position réelle non déclarée (missing_declared) : côté déclaré vide + côté réel rempli', () => {
    render(<RealityVsDeclared declared={null} reality={REALITY} />);
    expect(screen.getByText('Rien de déclaré pour cette position')).toBeInTheDocument();
    expect(screen.getByText('GBPUSD')).toBeInTheDocument();
    expect(screen.queryByText('EURUSD')).not.toBeInTheDocument();
  });

  it('trade déclaré sans contrepartie (false_declared) : côté réel vide + côté déclaré rempli', () => {
    render(<RealityVsDeclared declared={DECLARED} reality={null} />);
    expect(screen.getByText("Aucune trace dans l'historique fourni")).toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('GBPUSD')).not.toBeInTheDocument();
  });

  it('aucun côté (oubli de rituel) : ne rend rien', () => {
    const { container } = render(<RealityVsDeclared declared={null} reality={null} />);
    expect(container.firstChild).toBeNull();
  });
});
