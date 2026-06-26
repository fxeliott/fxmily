// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyGuidance, GuidanceAction } from '@/lib/daily-guidance/service';

import { TodayGuidance } from './today-guidance';

afterEach(cleanup);

/**
 * S6 §32-2 — render proof of the consolidated "plan du jour" states that the
 * full-page e2e cannot force deterministically (the slot + submitted flags drive
 * `missed`, and `timing` depends on ordering). Proves at render time:
 *  - a `missed` action renders the calm AMBER catch-up (never red — §31.2) with
 *    the "à rattraper" affordance;
 *  - the current/next actions carry the « Maintenant » / « Ensuite » markers;
 *  - a due `tracking` relevé renders as its own row;
 *  - the "tu es à jour" ack hides while a `missed` catch-up is still pending.
 */

const base: Omit<DailyGuidance, 'actions'> = {
  todayLabel: 'Lundi 8 juin 2026',
  today: '2026-06-08',
  slot: 'evening',
  weekStart: '2026-06-08',
  calendarState: 'none',
  todayBlocks: [],
};

function guidance(actions: GuidanceAction[]): DailyGuidance {
  return { ...base, actions };
}

const EVENING_TODO: GuidanceAction = {
  key: 'checkin-evening',
  kind: 'checkin',
  title: 'Check-in du soir',
  detail: 'Referme ta journée en conscience.',
  href: '/checkin/evening',
  state: 'todo',
  emphasis: 'primary',
  timing: 'current',
};

const MORNING_MISSED: GuidanceAction = {
  key: 'checkin-morning',
  kind: 'checkin',
  title: 'Check-in du matin',
  detail: 'Pas encore fait ce matin — tu peux le rattraper tranquillement.',
  href: '/checkin/morning',
  state: 'missed',
  emphasis: 'secondary',
  timing: 'next',
};

const TRACKING_DUE: GuidanceAction = {
  key: 'tracking-process-fidelity',
  kind: 'tracking',
  title: 'Fidélité à ton cadre',
  detail: 'Un court relevé de ton process à compléter quand tu veux.',
  href: '/tracking/process-fidelity',
  state: 'todo',
  emphasis: 'secondary',
};

describe('TodayGuidance — plan du jour consolidé (S6 §32-2, posture §2/§31.2)', () => {
  it('renders a missed action as a calm AMBER catch-up — never red', () => {
    render(<TodayGuidance guidance={guidance([EVENING_TODO, MORNING_MISSED, TRACKING_DUE])} />);

    const missed = document.querySelector('[data-slot="guidance-action"][data-state="missed"]');
    expect(missed).not.toBeNull();
    expect(missed?.getAttribute('data-kind')).toBe('checkin');
    expect(missed?.textContent ?? '').toMatch(/Check-in du matin/);
    expect(missed?.textContent ?? '').toMatch(/rattraper/i);
    // §31.2 — amber-benevolent ground, NEVER the red `--bad` alarm tokens.
    expect(missed?.className ?? '').toMatch(/warn/);
    expect(missed?.className ?? '').not.toMatch(/--bad/);
    // The trailing affordance reads as a catch-up, not a failure.
    expect(document.querySelector('[aria-label="à rattraper"]')).not.toBeNull();
  });

  it('marks the current + next actions with « Maintenant » / « Ensuite »', () => {
    render(<TodayGuidance guidance={guidance([EVENING_TODO, MORNING_MISSED])} />);
    expect(screen.getByText('Maintenant')).toBeInTheDocument();
    expect(screen.getByText('Ensuite')).toBeInTheDocument();
  });

  it('surfaces a due tracking relevé as its own row', () => {
    render(<TodayGuidance guidance={guidance([EVENING_TODO, TRACKING_DUE])} />);
    const tracking = document.querySelector('[data-slot="guidance-action"][data-kind="tracking"]');
    expect(tracking).not.toBeNull();
    expect(tracking?.getAttribute('href')).toBe('/tracking/process-fidelity');
    expect(tracking?.textContent ?? '').toMatch(/Fidélité à ton cadre/);
  });

  it('keeps the "tu es à jour" ack HIDDEN while a missed catch-up is pending', () => {
    render(<TodayGuidance guidance={guidance([MORNING_MISSED])} />);
    expect(screen.queryByText(/Tu es à jour/i)).not.toBeInTheDocument();
  });

  it('shows the calm "tu es à jour" ack when nothing is pending (only a done item)', () => {
    const done: GuidanceAction = { ...EVENING_TODO, state: 'done', timing: undefined };
    render(<TodayGuidance guidance={guidance([done])} />);
    expect(screen.getByText(/Tu es à jour/i)).toBeInTheDocument();
  });

  it('sur la ligne missed, le pill de timing prend le ton AMBRE (contraste WCAG, jamais rouge)', () => {
    // MORNING_MISSED porte timing:'next' → pill « Ensuite » sur le fond ambre.
    // Le ton `mute`/`acc` par défaut chute sous 4.5:1 sur `--warn-dim` ; `warn`
    // est la paire vettée à fort contraste, et reste ambre-calme (§31.2).
    render(<TodayGuidance guidance={guidance([EVENING_TODO, MORNING_MISSED])} />);
    const ensuite = screen.getByText('Ensuite');
    expect(ensuite.getAttribute('data-slot')).toBe('pill');
    expect(ensuite.getAttribute('data-tone')).toBe('warn');
  });

  it('marque le bloc du créneau courant avec « Maintenant » (§32-1 « au bon moment »)', () => {
    const withBlocks: DailyGuidance = {
      ...base,
      slot: 'evening',
      calendarState: 'generated',
      todayBlocks: [
        {
          slot: 'morning',
          category: 'backtest',
          durationMin: 60,
          label: 'Backtest matinal',
          priority: 'medium',
        },
        {
          slot: 'evening',
          category: 'mark_douglas_review',
          durationMin: 30,
          label: 'Revue Mark Douglas',
          priority: 'high',
        },
      ],
      actions: [],
    };
    render(<TodayGuidance guidance={withBlocks} />);
    // Seul le bloc du soir (créneau courant) porte le marqueur calme.
    const nowBlocks = document.querySelectorAll('li[data-now="true"]');
    expect(nowBlocks).toHaveLength(1);
    expect(nowBlocks[0]?.textContent ?? '').toMatch(/Revue Mark Douglas/);
    expect(screen.getByText('Maintenant')).toBeInTheDocument();
  });
});
