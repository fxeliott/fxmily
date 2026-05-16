// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the server action import BEFORE the component import so vitest hoists
// the mock above the wizard module's eager top-level imports.
vi.mock('@/app/review/actions', () => ({
  submitWeeklyReviewAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

// Replace Framer Motion with pass-through stubs so `AnimatePresence
// mode="wait"` doesn't keep the new step's content out of the DOM during
// the exit animation — making RTL queries deterministic.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionStub = new Proxy(
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
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: motionStub,
    m: motionStub,
    useReducedMotion: () => true,
  };
});

import { WeeklyReviewWizard } from './weekly-review-wizard';

/**
 * React-aware textarea value setter — `fireEvent.change` does not reliably
 * trigger the controlled component's `onChange` in React 19 + jsdom because
 * React's internal `_valueTracker` may swallow the change. The trick is to
 * reset the tracker's known value before assigning a new one, then dispatch
 * BOTH `input` and `change` so React's synthetic event router picks it up.
 */
function setTextareaReactValue(textarea: HTMLTextAreaElement, value: string): void {
  // 1. Defeat React's value-tracker (private API but stable across 16-19).
  const tracker = (textarea as unknown as { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  if (tracker) tracker.setValue(textarea.value);
  // 2. Native setter so React picks up the descriptor change.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  // 3. Dispatch BOTH events so the synthetic onChange fires.
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * V1.9 TIER F+ — RTL coverage for the V1.8 WeeklyReviewWizard.
 *
 * Targets the canonical wizard contract :
 *   1. Renders step 1 (informational) on first mount.
 *   2. Hydrates draft from `localStorage` (post-mount `useEffect`).
 *   3. Step transitions are gated by `isStepValid`.
 *   4. "Suivant" disabled until biggestWin reaches min chars ; enabled after.
 *
 * Carbon de `ai-generated-banner.test.tsx` pour le boilerplate jsdom +
 * manual cleanup (vitest.config.ts a `globals: false`).
 */

// `globals: false` ne register pas auto-cleanup — manual.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// Cold jsdom mount on Windows can spike past the 5s default.
vi.setConfig({ testTimeout: 15000 });

const DRAFT_KEY = 'fxmily:weekly-review:draft:v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('WeeklyReviewWizard — initial render', () => {
  it('renders step 1 / 5 (informational "Cette semaine") on first mount', () => {
    render(<WeeklyReviewWizard />);
    // The step header eyebrow is the canonical step indicator.
    expect(screen.getByText('Étape 1 sur 5')).toBeInTheDocument();
    // Step 1 title — process-language, no P&L.
    expect(screen.getByRole('heading', { name: 'Cette semaine' })).toBeInTheDocument();
    // Informational step → no textarea.
    expect(screen.queryByRole('textbox')).toBeNull();
    // Sticky "Suivant" CTA is rendered (informational step always valid).
    expect(screen.getByRole('button', { name: /Suivant/ })).toBeInTheDocument();
    // No "Précédent" on step 1.
    expect(screen.queryByRole('button', { name: /précédent/i })).toBeNull();
  });
});

describe('WeeklyReviewWizard — step navigation', () => {
  it('advances step 1 → step 2 (biggestWin textarea) on Suivant click', () => {
    render(<WeeklyReviewWizard />);
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(screen.getByText('Étape 2 sur 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ta plus grande victoire' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /précédent/i })).toBeInTheDocument();
  });

  it('disables Suivant on step 2 until biggestWin reaches 10 chars (REVIEW_TEXT_MIN_CHARS)', () => {
    render(<WeeklyReviewWizard />);
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // → step 2
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(screen.getByRole('button', { name: /Suivant/ })).toBeDisabled();

    // ≥ 10 chars (with trim) → enabled. Wrap in `act` so React 19's batched
    // state update + re-render commits before the assertion reads the
    // `disabled` attribute (otherwise the DOM reflects the prior render).
    act(() => {
      setTextareaReactValue(textarea, 'enough characters for the min validation rule.');
    });
    expect(screen.getByRole('button', { name: /Suivant/ })).not.toBeDisabled();
  });
});

describe('WeeklyReviewWizard — localStorage draft hydration', () => {
  it('hydrates biggestWin from localStorage on mount', async () => {
    const draft = {
      biggestWin: 'Held my plan despite the spike at NFP release.',
      biggestMistake: '',
      bestPractice: '',
      lessonLearned: '',
      nextWeekFocus: '',
    };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    render(<WeeklyReviewWizard />);
    // Navigate to step 2 to see the textarea seeded with the draft.
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

    // `useEffect` hydration runs after the first paint — RTL flushes
    // effects synchronously on render in React 19, so the textarea
    // should already contain the seeded value.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Held my plan despite the spike at NFP release.');
  });

  it('persists draft to localStorage after the user types', () => {
    render(<WeeklyReviewWizard />);
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // → step 2

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    setTextareaReactValue(textarea, 'A win typed in the wizard for persistence test.');

    const stored = window.localStorage.getItem(DRAFT_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { biggestWin: string };
    expect(parsed.biggestWin).toBe('A win typed in the wizard for persistence test.');
  });
});

describe('WeeklyReviewWizard — terminal step (5)', () => {
  it('shows the "Enregistrer ma revue" submit button on step 5', () => {
    render(<WeeklyReviewWizard />);
    const next = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

    // Step 1 (informational, always valid).
    next();
    // Step 2 — fill biggestWin then advance.
    setTextareaReactValue(
      screen.getByRole('textbox') as HTMLTextAreaElement,
      'win line filled with at least ten chars.',
    );
    next();
    // Step 3 — fill biggestMistake then advance.
    setTextareaReactValue(
      screen.getByRole('textbox') as HTMLTextAreaElement,
      'mistake line ten chars or more.',
    );
    next();
    // Step 4 — bestPractice is optional, advance with empty.
    next();
    // Step 5 — terminal submit button visible.
    expect(screen.getByText('Étape 5 sur 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enregistrer ma revue/ })).toBeInTheDocument();
  });
});
