// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/reflect/actions', () => ({
  createReflectionEntryAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

// Pass-through Framer Motion to avoid `AnimatePresence mode="wait"` timing
// issues in RTL — see weekly-review-wizard.test.tsx for rationale.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get: (_target, key) => {
          const tag = typeof key === 'string' ? key : 'div';
          // eslint-disable-next-line react/display-name
          return React.forwardRef(
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
          );
        },
      },
    ),
    useReducedMotion: () => true,
  };
});

import { ReflectionWizard } from './reflection-wizard';

function setTextareaReactValue(textarea: HTMLTextAreaElement, value: string): void {
  const tracker = (textarea as unknown as { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  if (tracker) tracker.setValue(textarea.value);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * V1.9 TIER F+ — RTL coverage for the V1.8 ReflectionWizard (CBT Ellis ABCD).
 *
 * Mirrors the WeeklyReview wizard contract (carbon by intent) :
 *   1. Renders step A on first mount.
 *   2. Hydrates draft from `localStorage`.
 *   3. Step transitions gated by `isStepValid`.
 *   4. Final step (D) shows the "Enregistrer cette réflexion" submit button.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

vi.setConfig({ testTimeout: 15000 });

const DRAFT_KEY = 'fxmily:reflection:draft:v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('ReflectionWizard — initial render', () => {
  it("renders step A (L'événement déclencheur) on first mount", () => {
    render(<ReflectionWizard />);
    // Step A is the trigger event.
    expect(screen.getByRole('heading', { name: /L'événement déclencheur/ })).toBeInTheDocument();
    // Step A has a textarea (every ABCD step does).
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // Suivant present but disabled (no input yet).
    expect(screen.getByRole('button', { name: /Suivant/ })).toBeDisabled();
    // No Précédent on step A.
    expect(screen.queryByRole('button', { name: /précédent/i })).toBeNull();
  });
});

describe('ReflectionWizard — step navigation', () => {
  it('disables Suivant on step A until triggerEvent reaches 10 chars', () => {
    render(<ReflectionWizard />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(screen.getByRole('button', { name: /Suivant/ })).toBeDisabled();

    // ≥ 10 chars (with trim) → enabled. `act` flushes the React 19 batched
    // state update + re-render before the assertion reads `disabled`.
    act(() => {
      setTextareaReactValue(textarea, 'NFP miss at 13h30 GMT, price spike during my coffee break.');
    });
    expect(screen.getByRole('button', { name: /Suivant/ })).not.toBeDisabled();
  });

  it('advances step A → step B (Belief) on Suivant click after valid input', () => {
    render(<ReflectionWizard />);
    setTextareaReactValue(
      screen.getByRole('textbox') as HTMLTextAreaElement,
      'NFP miss at 13h30 GMT, price spike during break.',
    );
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

    expect(screen.getByRole('heading', { name: /La pensée automatique/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /précédent/i })).toBeInTheDocument();
  });
});

describe('ReflectionWizard — localStorage draft hydration', () => {
  it('hydrates triggerEvent from localStorage on mount', () => {
    const draft = {
      triggerEvent: 'NFP miss yesterday — saw the spike post hoc.',
      beliefAuto: '',
      consequence: '',
      disputation: '',
    };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    render(<ReflectionWizard />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('NFP miss yesterday — saw the spike post hoc.');
  });

  it('persists draft to localStorage after the user types', () => {
    render(<ReflectionWizard />);
    setTextareaReactValue(
      screen.getByRole('textbox') as HTMLTextAreaElement,
      'Triggered by the unexpected market spike.',
    );
    const stored = window.localStorage.getItem(DRAFT_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { triggerEvent: string };
    expect(parsed.triggerEvent).toBe('Triggered by the unexpected market spike.');
  });
});

describe('ReflectionWizard — terminal step (D)', () => {
  it('shows the "Enregistrer cette réflexion" submit button on step D', () => {
    render(<ReflectionWizard />);

    // Walk A → B → C → D, filling each step with valid input.
    const steps = [
      'NFP miss, price spike during break — factual trigger.',
      'I must enter now or miss everything — automatic belief.',
      'FOMO 8/10, violated my NFP cooldown, entered at market.',
    ];
    for (const text of steps) {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      setTextareaReactValue(textarea, text);
      fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    }

    // Step D — the disputation. Final terminal submit button.
    expect(screen.getByRole('heading', { name: /Le reframe/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Enregistrer cette réflexion/ }),
    ).toBeInTheDocument();
  });
});
