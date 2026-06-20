// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MilestoneBanner } from './milestone-banner';

afterEach(() => {
  cleanup();
});

vi.setConfig({ testTimeout: 15000 });

/**
 * S11 — pins the dashboard milestone celebration: it names the milestone, frames
 * it Mark-Douglas-style (process, not trophy), exposes an AT live region, and is
 * dismissible. Anti-Black-Hat (§31.2): no "ne casse pas la chaîne", no FOMO.
 */
describe('MilestoneBanner', () => {
  it('names the milestone and exposes an accessible status', () => {
    render(<MilestoneBanner milestone={7} streak={7} />);
    expect(screen.getByText('Palier 7 jours')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/Palier de 7 jours de check-in franchi/);
  });

  it('uses calm, process-focused copy (anti-Black-Hat §31.2)', () => {
    const { container } = render(<MilestoneBanner milestone={30} streak={30} />);
    const text = container.textContent || '';
    expect(text).toMatch(/régularité t’appartient/);
    // No streak-loss anxiety / "don't break the chain" dark pattern.
    expect(text.toLowerCase()).not.toContain('chaîne');
    expect(text.toLowerCase()).not.toContain('ne casse pas');
    // No shouting fanfare.
    expect(text).not.toContain('!');
  });

  it('is dismissible', () => {
    render(<MilestoneBanner milestone={14} streak={14} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fermer le message de palier/ }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
