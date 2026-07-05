// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenTradesReminder } from './open-trades-reminder';

afterEach(cleanup);

/**
 * Tour 13 — render proof of the member-side "a trade is still open" reminder.
 * It is presentational; we prove it renders the copy, deep-links correctly
 * (single trade → its detail, several → the open filter), stays a REAL link
 * (a11y), never uses an outcome/red surface (process posture §2), hides itself
 * when nothing is stale, and carries no em dash (French copy rule).
 */

describe('OpenTradesReminder', () => {
  it('renders nothing when no trade is stale (count 0)', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 0, oldestTradeId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('single stale trade: singular copy + deep-links to the trade detail', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 1, oldestTradeId: 'trade_abc' }} />,
    );
    const link = container.querySelector('a[data-slot="open-trades-reminder"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/journal/trade_abc');
    expect(
      screen.getByText(/Un trade est encore ouvert depuis quelques jours/),
    ).toBeInTheDocument();
    expect(screen.getByText(/garde ton journal fidèle à ta réalité/)).toBeInTheDocument();
  });

  it('several stale trades: plural count + deep-links to the open journal filter', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 3, oldestTradeId: 'trade_abc' }} />,
    );
    const link = container.querySelector('a[data-slot="open-trades-reminder"]');
    expect(link?.getAttribute('href')).toBe('/journal?status=open');
    expect(
      screen.getByText(/3 trades sont encore ouverts depuis quelques jours/),
    ).toBeInTheDocument();
  });

  it('falls back to the open filter when a lone trade has no id', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 1, oldestTradeId: null }} />,
    );
    const link = container.querySelector('a[data-slot="open-trades-reminder"]');
    expect(link?.getAttribute('href')).toBe('/journal?status=open');
  });

  it('is a real accessible link with a descriptive label', () => {
    render(<OpenTradesReminder summary={{ count: 1, oldestTradeId: 'trade_abc' }} />);
    const link = screen.getByRole('link', {
      name: /Clôturer ton trade encore ouvert dans le journal/,
    });
    expect(link).toBeInTheDocument();
  });

  it('never uses a red/outcome surface (process posture, not an alert)', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 2, oldestTradeId: 'trade_abc' }} />,
    );
    const html = container.innerHTML;
    // Blue process accents only — never the bad/error tokens, never the amber
    // drift tokens (this is a calm process nudge, not a signal).
    expect(html).not.toContain('--bad');
    expect(html).not.toContain('--warn');
    expect(html).toContain('--acc');
  });

  it('carries no em dash in its copy (French punctuation rule)', () => {
    const { container } = render(
      <OpenTradesReminder summary={{ count: 2, oldestTradeId: 'trade_abc' }} />,
    );
    expect(container.textContent).not.toContain('—');
  });
});
