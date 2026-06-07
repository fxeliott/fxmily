// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S2 challenge-#4 audit (L4-02) — DoD#4 "Aucun QCM/test ne casse, sur tous les
 * écrans". The recurring pre-trade QCM wizard's multi-step UI was driven by NO
 * test (the e2e spec explicitly declares "NOT covered: driving the 4-step
 * wizard UI itself"; server-action coverage proves persistence, not the wizard).
 * A step-validation or per-step render regression would ship green. This RTL
 * test walks all 4 steps and pins the step-gating contract.
 */

vi.mock('@/app/pre-trade/actions', () => ({
  submitPreTradeCheckAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

// Pass-through Framer Motion (carbon reflection-wizard.test.tsx) so
// AnimatePresence mode="wait" does not stall the step transitions in RTL.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  // Memoize per tag so `m.div` keeps a STABLE component type across renders
  // (a fresh forwardRef each access would remount the subtree mid-walk).
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

import { PreTradeCheckWizard } from './pre-trade-wizard';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const nextBtn = () => screen.getByRole('button', { name: /Suivant/ });

describe('PreTradeCheckWizard — recurring QCM multi-step UI (DoD#4)', () => {
  it('mounts on step 1 (Raison) with "Suivant" gated until a choice is made', () => {
    render(<PreTradeCheckWizard />);
    expect(
      screen.getByRole('heading', { name: /Pourquoi tu prends ce trade/ }),
    ).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
  });

  it('advances through all 4 steps, re-gating "Suivant" at each, then unlocks final submit', () => {
    render(<PreTradeCheckWizard />);

    // Step 1 — Raison: pick an option → Suivant unlocks → advance.
    fireEvent.click(screen.getByRole('radio', { name: /Edge \/ setup éprouvé/ }));
    expect(nextBtn()).toBeEnabled();
    fireEvent.click(nextBtn());

    // Step 2 — Émotion: gated again until a choice.
    expect(screen.getByRole('heading', { name: /Comment tu te sens/ })).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /^Calme/ }));
    fireEvent.click(nextBtn());

    // Step 3 — Plan (Oui/Non boolean).
    expect(screen.getByRole('heading', { name: /Ce trade respecte ton plan/ })).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Oui' }));
    fireEvent.click(nextBtn());

    // Step 4 — Stop-loss: no more "Suivant", a disabled submit until answered.
    expect(screen.getByRole('heading', { name: /Ton stop-loss est défini/ })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Prends ton temps — enregistrer/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Oui' }));
    expect(submit).toBeEnabled();
  });

  it('preserves earlier answers when navigating back with "Précédent"', () => {
    render(<PreTradeCheckWizard />);
    fireEvent.click(screen.getByRole('radio', { name: /Peur de rater/ }));
    fireEvent.click(nextBtn());
    // On step 2 → go back.
    fireEvent.click(screen.getByRole('button', { name: /Étape précédente/ }));
    expect(
      screen.getByRole('heading', { name: /Pourquoi tu prends ce trade/ }),
    ).toBeInTheDocument();
    // The earlier choice is still selected (Suivant stays enabled, no re-pick needed).
    expect(screen.getByRole('radio', { name: /Peur de rater/ })).toBeChecked();
    expect(nextBtn()).toBeEnabled();
  });
});
