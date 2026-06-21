// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnimatedNumber } from './animated-number';
import { GradientBorder } from './gradient-border';
import { Magnetic } from './magnetic';
import { Reveal, RevealGroup } from './reveal';
import { Spotlight } from './spotlight';
import { Tilt3D } from './tilt-3d';

/**
 * S17 frontend-v2 — runtime behaviour proof for the premium "wow" primitive
 * layer (jsdom). These assert the contract the broad wiring relies on:
 *  - components mount and render their children / final value (no flash, no crash);
 *  - SSR-safe primitives surface the true value (AnimatedNumber never starts on 0
 *    in the accessibility tree);
 *  - the CSS-driven primitives (Spotlight / GradientBorder) emit the exact class
 *    + data-attribute contract that globals.css keys off.
 * Motion gestures (tilt / magnetic pull / count-up tween) ride the compositor and
 * IntersectionObserver, neither of which jsdom drives — so here we prove the
 * *structural* contract; the *visual* behaviour is proven at runtime in the
 * browser (playwright) on the wired public surfaces.
 */
afterEach(() => {
  cleanup();
});

describe('AnimatedNumber', () => {
  it('renders the final formatted value (SSR-safe — no flash of 0)', () => {
    render(<AnimatedNumber value={87} />);
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('honours a custom formatter', () => {
    render(<AnimatedNumber value={1234.4} format={(v) => `R ${Math.round(v)}`} />);
    expect(screen.getByText('R 1234')).toBeInTheDocument();
  });

  it('pins tabular-nums so digit width never jitters', () => {
    const { container } = render(<AnimatedNumber value={5} />);
    expect(container.querySelector('span')?.className).toContain('tabular-nums');
  });
});

describe('Tilt3D', () => {
  it('renders its hero children (passthrough)', () => {
    render(
      <Tilt3D>
        <button type="button">Hero</button>
      </Tilt3D>,
    );
    expect(screen.getByRole('button', { name: 'Hero' })).toBeInTheDocument();
  });
});

describe('Magnetic', () => {
  it('renders its CTA children (passthrough)', () => {
    render(
      <Magnetic>
        <button type="button">Go</button>
      </Magnetic>,
    );
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
});

describe('Spotlight', () => {
  it('wraps children in a .spotlight-surface (the globals.css glow contract)', () => {
    const { container } = render(
      <Spotlight>
        <p>card body</p>
      </Spotlight>,
    );
    expect(screen.getByText('card body')).toBeInTheDocument();
    expect(container.querySelector('.spotlight-surface')).not.toBeNull();
  });
});

describe('GradientBorder', () => {
  it('emits the ring structure + data-trigger contract', () => {
    const { container } = render(
      <GradientBorder trigger="always">
        <p>panel</p>
      </GradientBorder>,
    );
    expect(screen.getByText('panel')).toBeInTheDocument();
    const wrap = container.querySelector('.gradient-border');
    expect(wrap).not.toBeNull();
    expect(wrap?.getAttribute('data-trigger')).toBe('always');
    expect(container.querySelector('.gradient-border-inner')).not.toBeNull();
  });

  it('defaults the trigger to hover', () => {
    const { container } = render(
      <GradientBorder>
        <p>x</p>
      </GradientBorder>,
    );
    expect(container.querySelector('.gradient-border')?.getAttribute('data-trigger')).toBe('hover');
  });
});

describe('Reveal / RevealGroup', () => {
  it('Reveal renders its children', () => {
    render(
      <Reveal>
        <p>section</p>
      </Reveal>,
    );
    expect(screen.getByText('section')).toBeInTheDocument();
  });

  it('RevealGroup renders every child (staggered entrance)', () => {
    render(
      <RevealGroup>
        <p>a</p>
        <p>b</p>
        <p>c</p>
      </RevealGroup>,
    );
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });
});
