// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionPhaseGuidance, type SessionPhase } from '@/lib/session-routine/phase';
import type { SessionDayStatus, SessionRoutine } from '@/lib/session-routine/service';

import { SessionTimeline } from './session-timeline';

afterEach(cleanup);

/**
 * Render proof of the pre-trade branch grafted onto the "Discipline du jour"
 * block of the SessionTimeline. The phase clock + trade-fact chips are proven by
 * the S24 e2e; here we force the three pre-trade STATES the full-page run cannot
 * deterministically drive (they depend on the member's own-day check + phase):
 *  - fait               → calm constat "posé à HHhMM", never red, no CTA link;
 *  - non fait, fenêtre   → neutral invitation linking /pre-trade/new (accent, not warn);
 *  - non fait, hors fen. → nothing rendered (least intrusive — before / management / closed).
 * Posture §2 is asserted throughout: no market call, no urgency word, no red.
 */

function dayStatus(overrides: Partial<SessionDayStatus> = {}): SessionDayStatus {
  return {
    tradesEnteredToday: 0,
    enteredOutsideWindow: 0,
    lossToday: false,
    hasOpenPosition: false,
    preTradeToday: { done: false, at: null },
    ...overrides,
  };
}

function routine(phase: SessionPhase, day: SessionDayStatus): SessionRoutine {
  return { phase, guidance: sessionPhaseGuidance(phase), day };
}

describe('SessionTimeline — pre-trade du jour note', () => {
  it('renders a calm "posé à HHhMM" constat when the pre-trade is done', () => {
    render(
      <SessionTimeline
        routine={routine(
          'execution',
          dayStatus({ preTradeToday: { done: true, at: '2026-06-15T11:05:00.000Z' } }),
        )}
        timezone="Europe/Paris"
      />,
    );

    const note = document.querySelector('[data-slot="pre-trade-day-note"]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('data-state')).toBe('done');
    // 2026-06-15T11:05Z in Paris summer (UTC+2) = 13h05.
    expect(note?.textContent).toContain('Pré-trade du jour posé à 13h05.');
    // A constat is never a link (no CTA when already done).
    expect(note?.tagName.toLowerCase()).not.toBe('a');
  });

  it('honours the member timezone for the "posé à" label (Kiritimati +14)', () => {
    render(
      <SessionTimeline
        routine={routine(
          'execution',
          dayStatus({ preTradeToday: { done: true, at: '2026-06-15T11:05:00.000Z' } }),
        )}
        timezone="Pacific/Kiritimati"
      />,
    );
    // 11:05Z + 14h = 01h05 next day, local wall-clock 1h05.
    const note = document.querySelector('[data-slot="pre-trade-day-note"]');
    expect(note?.textContent).toContain('Pré-trade du jour posé à 1h05.');
  });

  it('renders a neutral invitation linking /pre-trade/new when not done, in window', () => {
    render(<SessionTimeline routine={routine('analysis', dayStatus())} timezone="Europe/Paris" />);

    const link = document.querySelector('[data-slot="pre-trade-day-note"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-state')).toBe('todo');
    expect(link?.tagName.toLowerCase()).toBe('a');
    expect(link?.getAttribute('href')).toBe('/pre-trade/new');
    expect(link?.textContent).toMatch(/pas encore posé ton pré-trade/i);
  });

  it('renders the invitation during the execution window too', () => {
    render(<SessionTimeline routine={routine('execution', dayStatus())} timezone="Europe/Paris" />);
    const link = document.querySelector('[data-slot="pre-trade-day-note"][data-state="todo"]');
    expect(link).not.toBeNull();
  });

  it.each<SessionPhase>(['before', 'management', 'closed'])(
    'renders NOTHING when not done and OUTSIDE the pre-trade window (%s)',
    (phase) => {
      render(<SessionTimeline routine={routine(phase, dayStatus())} timezone="Europe/Paris" />);
      expect(document.querySelector('[data-slot="pre-trade-day-note"]')).toBeNull();
    },
  );

  it('shows the done constat even outside the window (e.g. management)', () => {
    render(
      <SessionTimeline
        routine={routine(
          'management',
          dayStatus({ preTradeToday: { done: true, at: '2026-06-15T11:05:00.000Z' } }),
        )}
        timezone="Europe/Paris"
      />,
    );
    const note = document.querySelector('[data-slot="pre-trade-day-note"][data-state="done"]');
    expect(note).not.toBeNull();
  });

  it('posture §2 — the pre-trade note never issues a market call nor a red verdict', () => {
    const { container } = render(
      <SessionTimeline routine={routine('analysis', dayStatus())} timezone="Europe/Paris" />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/ach[èe]te|vends?/i);
    expect(text).not.toMatch(/oblig|urgent|maintenant ou jamais|tu as échoué|verdict/i);
  });

  it('defaults the timezone to Europe/Paris when the prop is omitted', () => {
    render(
      <SessionTimeline
        routine={routine(
          'execution',
          dayStatus({ preTradeToday: { done: true, at: '2026-06-15T11:05:00.000Z' } }),
        )}
      />,
    );
    const note = document.querySelector('[data-slot="pre-trade-day-note"]');
    expect(note?.textContent).toContain('13h05');
  });
});
