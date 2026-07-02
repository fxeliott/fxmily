// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SleepHabitPrefill } from '@/lib/habit/today-log';

/**
 * P3 fix — the sleep pillar wizard must start SEEDED from the server `prefill`
 * (today's existing log) so a re-submission is an explicit edit, never a silent
 * overwrite of an invisible value. This RTL test pins:
 *   - prefill seeds the hours input + notes on mount (edit mode);
 *   - a non-empty local draft field still wins over the prefill (mid-edit
 *     reload never loses keystrokes — weekly-review-wizard parity);
 *   - no prefill + no draft = empty form (historical behavior preserved).
 */

vi.mock('@/app/track/actions', () => ({
  submitHabitLogAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map<string | symbol, React.ComponentType<Record<string, unknown>>>();
  const motionStub = new Proxy(
    {},
    {
      get: (_target, key) => {
        const existing = cache.get(key);
        if (existing) return existing;
        const tag = typeof key === 'string' ? key : 'div';
        // eslint-disable-next-line react/display-name
        const Comp = React.forwardRef(
          (
            props: Record<string, unknown> & { children?: React.ReactNode },
            ref: React.Ref<HTMLElement>,
          ) => {
            const {
              initial: _initial,
              animate: _animate,
              exit: _exit,
              transition: _transition,
              variants: _variants,
              whileHover: _wh,
              whileTap: _wt,
              whileInView: _wiv,
              ...rest
            } = props;
            return React.createElement(tag, { ref, ...rest });
          },
        ) as unknown as React.ComponentType<Record<string, unknown>>;
        cache.set(key, Comp);
        return Comp;
      },
    },
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: motionStub,
    m: motionStub,
    useReducedMotion: () => true,
  };
});

import { SleepHabitWizard } from './sleep-habit-wizard';

const DRAFT_STORAGE_KEY = 'fxmily:track:sleep:draft:v1';

const PREFILL: SleepHabitPrefill = {
  sleepHours: '7,5',
  sleepQuality: 8,
  notes: 'Couché tôt.',
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const hoursInput = () =>
  screen.getByLabelText('Durée', { selector: '#sleep-hours' }) as HTMLInputElement;

describe('SleepHabitWizard — P3 already-logged prefill', () => {
  it('seeds the hours input from prefill on mount (edit mode)', () => {
    render(<SleepHabitWizard prefill={PREFILL} />);
    // Step 0 is "Durée & qualité" — the hours input carries the prefill value.
    expect(hoursInput().value).toBe('7,5');
  });

  it('starts empty when no prefill and no local draft', () => {
    render(<SleepHabitWizard />);
    expect(hoursInput().value).toBe('');
  });

  it('lets a non-empty local draft field win over the prefill (no lost keystrokes)', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ date: '2000-01-01', sleepHours: '6', sleepQuality: 3, notes: '' }),
    );
    render(<SleepHabitWizard prefill={PREFILL} />);
    // The stored `sleepHours: '6'` (non-empty) overrides the prefill '7,5'.
    expect(hoursInput().value).toBe('6');
  });

  it('falls back to the prefill for an empty stored field', () => {
    // Stored draft blanks hours → the prefill value must fill it back in rather
    // than leaving an empty input that would re-overwrite the day on submit.
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ date: '2000-01-01', sleepHours: '', sleepQuality: 8, notes: '' }),
    );
    render(<SleepHabitWizard prefill={PREFILL} />);
    expect(hoursInput().value).toBe('7,5');
  });
});
