// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SeanceBiasBasket } from './bias-basket';
import { BiasSynthesis } from './bias-synthesis';
import { pickCorrelatedSatellites, SeanceMacroCompass } from './macro-compass';
import { SessionChoreography } from './session-choreography';
import type { SeanceAssetView } from '@/lib/seances/service';

// `vitest.config.ts` has `globals: false` → wire RTL cleanup manually.
afterEach(() => {
  cleanup();
});

// jsdom cold-start on Windows can spike past the 5s default (cf. other .test.tsx).
vi.setConfig({ testTimeout: 15000 });

/**
 * Runtime render coverage for the premium séance schemas (macro compass, bias
 * basket, session choreography) + the adaptive bias table. These are pure Server
 * Components, so jsdom render proves they mount without throwing and encode
 * meaning without relying on colour alone (WCAG 1.4.1: icon + word present).
 */

function asset(partial: Partial<SeanceAssetView> & { symbol: string }): SeanceAssetView {
  return {
    id: partial.id ?? `id-${partial.symbol}`,
    symbol: partial.symbol,
    name: partial.name ?? null,
    bias: partial.bias ?? null,
    macro: partial.macro ?? false,
    levels: partial.levels ?? [],
    reading: partial.reading ?? [],
    anchorId: partial.anchorId ?? `actif-${partial.symbol}`,
  };
}

const DXY = asset({ symbol: 'DXY', name: 'Indice dollar', bias: 'baissier', macro: true });
const EUR = asset({ symbol: 'EURUSD', name: 'Euro / Dollar', bias: 'haussier' });
const GBP = asset({ symbol: 'GBPUSD', name: 'Livre / Dollar', bias: 'neutre' });
const XAU = asset({ symbol: 'XAUUSD', name: 'Or', bias: 'haussier' });
const NQ = asset({ symbol: 'NQ', name: 'Nasdaq 100', bias: 'baissier' });
const SP500 = asset({ symbol: 'SP500', name: 'S&P 500', bias: 'baissier' });

const TRADED = [EUR, XAU, NQ, SP500, GBP];

describe('pickCorrelatedSatellites', () => {
  it('keeps only the USD-inverse basket (EUR/GBP/XAU), in order', () => {
    expect(pickCorrelatedSatellites(TRADED).map((a) => a.symbol)).toEqual([
      'EURUSD',
      'XAUUSD',
      'GBPUSD',
    ]);
  });

  it('excludes the indices', () => {
    const syms = pickCorrelatedSatellites(TRADED).map((a) => a.symbol);
    expect(syms).not.toContain('NQ');
    expect(syms).not.toContain('SP500');
  });
});

describe('SeanceMacroCompass', () => {
  it('renders the conductor and every satellite with its OWN stated bias', () => {
    render(<SeanceMacroCompass conductor={DXY} satellites={[EUR, GBP, XAU]} />);
    const fig = screen.getByRole('figure');
    expect(within(fig).getByText('DXY')).toBeInTheDocument();
    expect(within(fig).getByText('EURUSD')).toBeInTheDocument();
    expect(within(fig).getByText('GBPUSD')).toBeInTheDocument();
    expect(within(fig).getByText('XAUUSD')).toBeInTheDocument();
    // GBP stayed neutre despite the inverse tendency → shown as neutre (fidelity).
    expect(within(fig).getAllByText('Neutre').length).toBeGreaterThanOrEqual(1);
    expect(within(fig).getAllByText('Haussier').length).toBeGreaterThanOrEqual(2);
  });

  it('adapts the mechanism sentence to a bearish conductor', () => {
    render(<SeanceMacroCompass conductor={DXY} satellites={[EUR]} />);
    expect(screen.getByText(/Quand le dollar baisse/)).toBeInTheDocument();
  });

  it('adapts the mechanism sentence to a bullish conductor', () => {
    render(
      <SeanceMacroCompass
        conductor={asset({ symbol: 'DXY', bias: 'haussier' })}
        satellites={[EUR]}
      />,
    );
    expect(screen.getByText(/Quand le dollar monte/)).toBeInTheDocument();
  });

  it('self-omits when there is no satellite', () => {
    const { container } = render(<SeanceMacroCompass conductor={DXY} satellites={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SeanceBiasBasket', () => {
  it('groups the roster by direction with a visible count and label (never colour alone)', () => {
    render(<SeanceBiasBasket assets={TRADED} />);
    const group = screen.getByRole('group', { name: /Panier du jour/ });
    // 3 groups present, each labelled with a word (icon + word, not colour alone).
    expect(within(group).getByText('Haussier')).toBeInTheDocument();
    expect(within(group).getByText('Neutre')).toBeInTheDocument();
    expect(within(group).getByText('Baissier')).toBeInTheDocument();
    // Every traded symbol appears exactly once.
    for (const s of ['EURUSD', 'XAUUSD', 'GBPUSD', 'NQ', 'SP500']) {
      expect(within(group).getByText(s)).toBeInTheDocument();
    }
  });

  it('omits an empty direction group instead of showing a dangling column', () => {
    // Only bullish assets → no Neutre / Baissier headers.
    render(<SeanceBiasBasket assets={[EUR, XAU]} />);
    expect(screen.getByText('Haussier')).toBeInTheDocument();
    expect(screen.queryByText('Baissier')).toBeNull();
    expect(screen.queryByText('Neutre')).toBeNull();
  });

  it('self-omits with no assets', () => {
    const { container } = render(<SeanceBiasBasket assets={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SessionChoreography', () => {
  it('renders the two-phase principle and the five session windows', () => {
    render(<SessionChoreography />);
    expect(screen.getByText(/Phase 1/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 2/)).toBeInTheDocument();
    // The NY session windows (Europe/Paris).
    expect(screen.getByText('13h–14h')).toBeInTheDocument();
    expect(screen.getByText('15h30')).toBeInTheDocument();
    expect(screen.getByText('15h30–16h')).toBeInTheDocument();
  });
});

describe('BiasSynthesis (adaptive Repère column)', () => {
  it('shows the Repère column when at least one asset has a level', () => {
    const withLevel = asset({
      symbol: 'EURUSD',
      bias: 'haussier',
      levels: [{ label: 'Pivot', value: '1,13' }],
    });
    render(<BiasSynthesis assets={[withLevel, NQ]} />);
    expect(screen.getByRole('columnheader', { name: 'Repère clé' })).toBeInTheDocument();
    expect(screen.getByText('1,13')).toBeInTheDocument();
  });

  it('drops the Repère column when no asset stated a level (structural-only séance)', () => {
    render(<BiasSynthesis assets={[EUR, NQ]} />);
    expect(screen.queryByRole('columnheader', { name: 'Repère clé' })).toBeNull();
    // Still a real accessible table with the two remaining headers.
    expect(screen.getByRole('columnheader', { name: 'Actif' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Biais' })).toBeInTheDocument();
  });

  it('self-omits below 2 assets', () => {
    const { container } = render(<BiasSynthesis assets={[EUR]} />);
    expect(container.firstChild).toBeNull();
  });
});
