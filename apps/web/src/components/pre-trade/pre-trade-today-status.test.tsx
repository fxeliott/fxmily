// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PreTradeTodayStatus, formatCheckTime } from './pre-trade-today-status';

/**
 * P3 fix — the /journal/new pre-trade recall. Two calm states (done / todo),
 * Mark Douglas posture (no red, no pressure). These tests pin: (1) the
 * timezone-aware HHhMM label, (2) the correct copy + link per state, (3) the
 * NEVER-red invariant (no `warn` token surfaces).
 */

afterEach(cleanup);

describe('formatCheckTime', () => {
  it('renders a Europe/Paris afternoon instant as compact French HHhMM', () => {
    // 2026-05-26T13:05Z = 15:05 Paris (CEST, +2).
    expect(formatCheckTime('2026-05-26T13:05:00.000Z', 'Europe/Paris')).toBe('15h05');
  });

  it('keeps minutes 2-digit (a timestamp, not a slot) — 9h00 not 9h', () => {
    // 2026-05-26T07:00Z = 09:00 Paris.
    expect(formatCheckTime('2026-05-26T07:00:00.000Z', 'Europe/Paris')).toBe('9h00');
  });

  it('strips the hour zero-pad (9h05 not 09h05)', () => {
    // 2026-05-26T07:05Z = 09:05 Paris.
    expect(formatCheckTime('2026-05-26T07:05:00.000Z', 'Europe/Paris')).toBe('9h05');
  });

  it('honours a non-Paris timezone (New York, -4 EDT)', () => {
    // 2026-05-26T13:05Z = 09:05 New York.
    expect(formatCheckTime('2026-05-26T13:05:00.000Z', 'America/New_York')).toBe('9h05');
  });

  it('falls back to UTC on a malformed timezone (defensive, never throws)', () => {
    expect(formatCheckTime('2026-05-26T13:05:00.000Z', 'Not/AZone')).toBe('13h05');
  });
});

describe('PreTradeTodayStatus — done state', () => {
  it('shows the "fait à HHhMM" recall with a link to the recap', () => {
    render(
      <PreTradeTodayStatus
        status={{ done: true, at: '2026-05-26T13:05:00.000Z' }}
        timezone="Europe/Paris"
      />,
    );

    expect(screen.getByText('Pré-trade du jour fait à 15h05')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'Voir le récapitulatif de mes pré-trades',
    });
    expect(link.getAttribute('href')).toBe('/patterns');
  });

  it('reassures the member their prep is recorded (no need to redo)', () => {
    render(
      <PreTradeTodayStatus
        status={{ done: true, at: '2026-05-26T13:05:00.000Z' }}
        timezone="Europe/Paris"
      />,
    );

    expect(
      screen.getByText('Ta préparation est enregistrée. Pas besoin de la refaire.'),
    ).toBeTruthy();
  });

  it('marks the done container with data-state="done"', () => {
    const { container } = render(
      <PreTradeTodayStatus
        status={{ done: true, at: '2026-05-26T13:05:00.000Z' }}
        timezone="Europe/Paris"
      />,
    );
    const root = container.querySelector('[data-slot="pre-trade-today-status"]');
    expect(root?.getAttribute('data-state')).toBe('done');
  });
});

describe('PreTradeTodayStatus — todo state', () => {
  it('invites the member to /pre-trade/new without pressure', () => {
    render(<PreTradeTodayStatus status={{ done: false, at: null }} timezone="Europe/Paris" />);

    expect(screen.getByText('Pense à ton pré-trade')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'Faire la pause pré-trade avant de saisir ton trade',
    });
    expect(link.getAttribute('href')).toBe('/pre-trade/new');
  });

  it('keeps the invitation explicitly optional', () => {
    render(<PreTradeTodayStatus status={{ done: false, at: null }} timezone="Europe/Paris" />);

    expect(screen.getByText('Une pause de 30 secondes avant d’entrer. Optionnel.')).toBeTruthy();
  });

  it('falls back to todo when done is true but `at` is missing (defensive)', () => {
    render(<PreTradeTodayStatus status={{ done: true, at: null }} timezone="Europe/Paris" />);

    // No timestamp → we cannot render "fait à HHhMM" honestly, so the calm
    // invitation renders instead of a broken "fait à ".
    expect(screen.getByText('Pense à ton pré-trade')).toBeTruthy();
  });

  it('marks the todo container with data-state="todo"', () => {
    const { container } = render(
      <PreTradeTodayStatus status={{ done: false, at: null }} timezone="Europe/Paris" />,
    );
    const root = container.querySelector('[data-slot="pre-trade-today-status"]');
    expect(root?.getAttribute('data-state')).toBe('todo');
  });
});

describe('PreTradeTodayStatus — Mark Douglas posture (§2)', () => {
  it('NEVER surfaces a warning/red tone in either state', () => {
    const { container: doneC } = render(
      <PreTradeTodayStatus
        status={{ done: true, at: '2026-05-26T13:05:00.000Z' }}
        timezone="Europe/Paris"
      />,
    );
    expect(doneC.innerHTML).not.toContain('--warn');
    expect(doneC.innerHTML).not.toContain('--danger');

    cleanup();

    const { container: todoC } = render(
      <PreTradeTodayStatus status={{ done: false, at: null }} timezone="Europe/Paris" />,
    );
    expect(todoC.innerHTML).not.toContain('--warn');
    expect(todoC.innerHTML).not.toContain('--danger');
  });
});
