// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EquityCurve } from '@/components/illustrations/equity-curve';

import { EmptyState } from './empty-state';

/**
 * Tour 16 — structural contract of the `illustration` strate. The visual
 * behaviour (SVG paints, animates, no NaN coords) is proven at runtime in a
 * real browser; here we pin the swap logic the ~35 call-sites rely on:
 * a custom illustration REPLACES the icon halo (never both), and omitting it
 * keeps the halo untouched (zero breaking change).
 */
afterEach(() => {
  cleanup();
});

describe('EmptyState illustration strate', () => {
  it('renders the icon halo when no illustration is provided', () => {
    const { container } = render(<EmptyState headline="Rien ici." />);
    expect(screen.getByText('Rien ici.')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide')).not.toBeNull();
  });

  it('replaces the icon halo entirely when an illustration is provided', () => {
    const { container } = render(
      <EmptyState
        illustration={<EquityCurve className="mx-auto w-full max-w-[200px]" />}
        headline="Le hub est prêt."
      />,
    );
    expect(screen.getByText('Le hub est prêt.')).toBeInTheDocument();
    // The maison SVG mounts (EquityCurve root class), the lucide halo does not.
    expect(container.querySelector('svg.ec-root')).not.toBeNull();
    expect(container.querySelector('svg.lucide')).toBeNull();
    // Decorative: the wrapper strate is aria-hidden.
    expect(container.querySelector('svg.ec-root')?.closest('[aria-hidden]')).not.toBeNull();
  });
});
