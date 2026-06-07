// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S2 challenge-#4 audit (L4-02) — DoD#4 "Aucun QCM/test ne casse, sur tous les
 * écrans". The recurring weekly mindset QCM wizard's multi-step Likert UI was
 * driven by NO test (the e2e spec explicitly defers "driving the Likert wizard
 * UI"). A per-step validation / render regression in the 6-dimension / 12-item
 * instrument would ship green. This RTL test walks all 6 steps and pins the
 * "both items answered" gating contract + the final submit unlock.
 */

vi.mock('@/app/mindset/actions', () => ({
  submitMindsetCheckAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // Cache the stubbed component PER tag — a Proxy that returns a fresh
  // `forwardRef` on every access would give `m.div` a new component type on
  // each render, forcing React to remount the whole subtree (detaching the
  // radiogroup/radio nodes mid-interaction). Memoizing keeps the type stable.
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

import { MindsetCheckWizard } from './mindset-wizard';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const nextBtn = () => screen.getByRole('button', { name: /Suivant/ });

/**
 * Click the `value` radio in every Likert item rendered on the current step.
 * Re-queries the radiogroup list before each click (each click re-renders the
 * wizard) so we never operate on a stale node.
 */
function answerCurrentStep(value: number) {
  const count = screen.getAllByRole('radiogroup').length;
  for (let i = 0; i < count; i++) {
    const group = screen.getAllByRole('radiogroup')[i]!;
    fireEvent.click(within(group).getByRole('radio', { name: new RegExp(`^${value} sur 5`) }));
  }
  return count;
}

describe('MindsetCheckWizard — recurring weekly QCM multi-step UI (DoD#4)', () => {
  it('mounts on the first dimension with "Suivant" gated', () => {
    render(<MindsetCheckWizard weekStart="2026-06-01" />);
    expect(
      screen.getByRole('heading', { name: /Acceptation de l'incertitude/ }),
    ).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
  });

  it('requires BOTH items of a dimension before "Suivant" unlocks', () => {
    render(<MindsetCheckWizard weekStart="2026-06-01" />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2); // 2 Likert items per dimension
    // Answer only the first item → still gated. (Re-query before each click —
    // every state change re-renders the wizard.)
    fireEvent.click(
      within(screen.getAllByRole('radiogroup')[0]!).getByRole('radio', { name: /^4 sur 5/ }),
    );
    expect(nextBtn()).toBeDisabled();
    // Answer the second → unlocks.
    fireEvent.click(
      within(screen.getAllByRole('radiogroup')[1]!).getByRole('radio', { name: /^3 sur 5/ }),
    );
    expect(nextBtn()).toBeEnabled();
  });

  it('walks all 6 dimensions and unlocks the final "Enregistrer" submit', () => {
    render(<MindsetCheckWizard weekStart="2026-06-01" />);
    // 5 advances across the 6 dimensions; each step re-gates "Suivant".
    for (let step = 0; step < 5; step++) {
      expect(nextBtn()).toBeDisabled();
      expect(answerCurrentStep(4)).toBe(2);
      expect(nextBtn()).toBeEnabled();
      fireEvent.click(nextBtn());
    }
    // Step 6 (last): no "Suivant", a disabled submit until this step is answered.
    expect(screen.queryByRole('button', { name: /Suivant/ })).toBeNull();
    const submit = screen.getByRole('button', { name: /Enregistrer mon auto-évaluation/ });
    expect(submit).toBeDisabled();
    answerCurrentStep(5);
    expect(submit).toBeEnabled();
  });
});
