// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * S2 audit 2026-06-11 — TIER1 « crisis banner never visible ».
 *
 * The onboarding interview wizard auto-advanced on EVERY `state.ok`, including
 * when the action came back with `crisisLevel: 'high'|'medium'` — the step
 * (which owns the banner render) unmounted in the same cycle, so the 3114 /
 * SOS Amitié resources were NEVER shown to a member in distress. These tests
 * drive the REAL wizard UI (RTL) and pin the safety-hold contract :
 *   1. crisis MEDIUM/HIGH → banner visible, NO auto-advance, explicit
 *      « continuer » button advances.
 *   2. clean answer → auto-advance preserved (no regression on the happy path).
 *
 * Also the first automated test that DRIVES this 830-line wizard at all
 * (residual hole of the MAJ-8 L4-02 closure — it covered pre-trade + mindset).
 */

const appendAnswerActionMock = vi.fn();

vi.mock('@/app/onboarding/interview/actions', () => ({
  appendAnswerAction: (prev: unknown, formData: FormData) => appendAnswerActionMock(prev, formData),
  finalizeInterviewAction: vi.fn(async () => null),
}));

// Pass-through Framer Motion (carbon pre-trade-wizard.test.tsx) so
// AnimatePresence mode="wait" does not stall step transitions in RTL.
// Memoize per tag so `m.div` keeps a STABLE component type across renders.
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

import { OnboardingInterviewWizard } from './onboarding-interview-wizard';
import { ONBOARDING_INSTRUMENT_V1 } from '@/lib/onboarding-interview/instrument-v1';

const Q0_TEXT = ONBOARDING_INSTRUMENT_V1.items[0]!.text;
const Q1_TEXT = ONBOARDING_INSTRUMENT_V1.items[1]!.text;
const ANSWER = 'Une réponse honnête et suffisamment longue pour passer la validation.';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  appendAnswerActionMock.mockReset();
});

function renderWizardAtQ0() {
  render(<OnboardingInterviewWizard initialStep={0} initialAnswers={{}} />);
  expect(screen.getByRole('heading', { name: Q0_TEXT })).toBeTruthy();
}

async function typeAndSubmit() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ANSWER } });
  fireEvent.click(screen.getByRole('button', { name: /Suivant/i }));
}

describe('OnboardingInterviewWizard — safety hold (crisis / injection)', () => {
  it('holds the step and shows the 3114 banner on crisisLevel=high (no auto-advance)', async () => {
    appendAnswerActionMock.mockResolvedValue({ ok: true, crisisLevel: 'high' });
    renderWizardAtQ0();
    await typeAndSubmit();

    // Banner with the FR crisis resources is VISIBLE (the old code unmounted
    // the step before any paint).
    const banner = await screen.findByText(/tu n'es pas seul/i);
    expect(banner).toBeTruthy();
    expect(screen.getByRole('link', { name: /3114/i })).toBeTruthy();

    // The step did NOT advance — Q0 heading still mounted, Q1 absent.
    expect(screen.getByRole('heading', { name: Q0_TEXT })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: Q1_TEXT })).toBeNull();

    // The explicit continue button advances to Q1.
    fireEvent.click(screen.getByRole('button', { name: /continuer l'entretien/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: Q1_TEXT })).toBeTruthy();
    });
  });

  it('holds on crisisLevel=medium too', async () => {
    appendAnswerActionMock.mockResolvedValue({ ok: true, crisisLevel: 'medium' });
    renderWizardAtQ0();
    await typeAndSubmit();

    await screen.findByText(/tu n'es pas seul/i);
    expect(screen.getByRole('heading', { name: Q0_TEXT })).toBeTruthy();
  });

  it('holds on injectionSuspected', async () => {
    appendAnswerActionMock.mockResolvedValue({ ok: true, injectionSuspected: true });
    renderWizardAtQ0();
    await typeAndSubmit();

    await screen.findByRole('button', { name: /continuer l'entretien/i });
    expect(screen.getByRole('heading', { name: Q0_TEXT })).toBeTruthy();
  });

  it('still auto-advances on a clean answer (happy path unchanged)', async () => {
    appendAnswerActionMock.mockResolvedValue({ ok: true });
    renderWizardAtQ0();
    await typeAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: Q1_TEXT })).toBeTruthy();
    });
    expect(screen.queryByText(/tu n'es pas seul/i)).toBeNull();
  });

  it('crisisLevel=low (noise by design, no banner) still auto-advances', async () => {
    appendAnswerActionMock.mockResolvedValue({ ok: true, crisisLevel: 'low' });
    renderWizardAtQ0();
    await typeAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: Q1_TEXT })).toBeTruthy();
    });
  });
});
