// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WeeklyRecapCard, type WeeklyRecapCounters } from './weekly-recap-card';

/**
 * Runtime DOM validation (jsdom) for `WeeklyRecapCard` — the real concern the
 * frontend-elite gate raises: the JSX actually renders, the calm colour ramp
 * resolves to the right token (green up / grey down, NEVER red), the honest
 * empty state shows, and the a11y label is present. Pure Server-Component-safe
 * markup (no client hooks beyond InfoDot's Popover trigger button), so it
 * renders synchronously under RTL.
 */

function counters(over: Partial<WeeklyRecapCounters> = {}): WeeklyRecapCounters {
  return {
    tradesTotal: 0,
    planRespectRate: null,
    streakDays: 0,
    eveningCheckinsCount: 0,
    ...over,
  };
}

describe('<WeeklyRecapCard /> — runtime DOM', () => {
  it('renders the pedagogical empty state for an inactive week (no fabricated 0s)', () => {
    render(<WeeklyRecapCard current={counters()} previous={counters({ tradesTotal: 5 })} />);
    const card = screen.getByLabelText('Ta semaine en chiffres');
    expect(card).toBeInTheDocument();
    // No recap data-slot in the empty state.
    expect(card.querySelector('[data-slot="weekly-recap-card"]')).toBeNull();
    expect(screen.getByText(/ton récap chiffré apparaîtra ici/i)).toBeInTheDocument();
  });

  it('renders the 4 metric tiles with values and a first-week notice (no deltas)', () => {
    render(
      <WeeklyRecapCard
        current={counters({
          tradesTotal: 8,
          planRespectRate: 0.75,
          streakDays: 6,
          eveningCheckinsCount: 6,
        })}
        previous={null}
      />,
    );
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('75 %')).toBeInTheDocument();
    expect(screen.getByText('6 j')).toBeInTheDocument();
    // First measured week → explicit copy, no fabricated delta pills.
    expect(screen.getByText(/Première semaine mesurée/i)).toBeInTheDocument();
    expect(screen.queryByText('+10 pts')).toBeNull();
  });

  it('paints a RISING metric green (--ok) and never red', () => {
    const { container } = render(
      <WeeklyRecapCard
        current={counters({
          tradesTotal: 8,
          planRespectRate: 0.75,
          streakDays: 6,
          eveningCheckinsCount: 6,
        })}
        previous={counters({
          tradesTotal: 5,
          planRespectRate: 0.65,
          streakDays: 4,
          eveningCheckinsCount: 4,
        })}
      />,
    );
    const planTile = container.querySelector('[data-metric="planRespect"]')!;
    const pill = within(planTile as HTMLElement).getByText('+10 pts');
    expect(pill.className).toContain('text-[var(--ok)]');
    // Hard guarantee: no error/red token anywhere in the rendered card.
    expect(container.innerHTML).not.toMatch(/--err|--danger|--bad|text-red/);
  });

  it('paints a FALLING metric neutral grey (--t-3), NOT red (anti-Black-Hat)', () => {
    const { container } = render(
      <WeeklyRecapCard
        current={counters({
          tradesTotal: 2,
          planRespectRate: 0.5,
          streakDays: 2,
          eveningCheckinsCount: 2,
        })}
        previous={counters({
          tradesTotal: 5,
          planRespectRate: 0.65,
          streakDays: 4,
          eveningCheckinsCount: 4,
        })}
      />,
    );
    const planTile = container.querySelector('[data-metric="planRespect"]')!;
    const pill = within(planTile as HTMLElement).getByText('−15 pts');
    expect(pill.className).toContain('text-[var(--t-3)]');
    expect(pill.className).not.toContain('--ok');
    expect(container.innerHTML).not.toMatch(/--err|--danger|--bad|text-red/);
  });
});
