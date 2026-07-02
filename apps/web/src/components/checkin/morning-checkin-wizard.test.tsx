// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Framer Motion pass-through — same pattern as the other wizard/component tests
// (strip animation-only props so jsdom renders the final state synchronously).
vi.mock('framer-motion', async () => {
  const React = await import('react');
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  const drop = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
    'layout',
    'layoutId',
    'variants',
    'custom',
    'onAnimationStart',
    'onAnimationComplete',
  ]);
  const strip = (rest: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (!drop.has(k)) out[k] = v;
    return out;
  };
  const passthrough = (Tag: string) => {
    const C = ({ children, ...rest }: Props) => React.createElement(Tag, strip(rest), children);
    C.displayName = `MockMotion(${Tag})`;
    return C;
  };
  const motion = new Proxy({}, { get: (_t, prop: string) => passthrough(prop) });
  return {
    motion,
    m: motion,
    AnimatePresence: ({ children }: Props) => React.createElement(React.Fragment, null, children),
    LazyMotion: ({ children }: Props) => React.createElement(React.Fragment, null, children),
    domAnimation: {},
    useReducedMotion: () => true,
  };
});

// The Server Action pulls in server-only code (auth/db) — replace it entirely.
vi.mock('@/app/checkin/actions', () => ({
  submitMorningCheckinAction: vi.fn(),
}));
vi.mock('@/lib/haptics', () => ({
  hapticTap: vi.fn(),
  hapticError: vi.fn(),
  hapticSuccess: vi.fn(),
}));

import { MorningCheckinWizard } from './morning-checkin-wizard';
// Resolves to the vi.fn() mock declared above — imported so the full-drive tests
// can assert whether the server action was (not) called.
import { submitMorningCheckinAction } from '@/app/checkin/actions';

// Module-private key (stable contract) — mirror it here to assert the pitfall.
const TODAY_DRAFT_KEY = 'fxmily:checkin:morning:draft:v1';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

vi.setConfig({ testTimeout: 15000 });

/**
 * F7 Layer 3 — rattrapage (backfill) mode of the morning wizard. The single
 * most important invariant is the #1 pitfall: a rattrapage must NEVER read nor
 * overwrite the today localStorage draft (that would corrupt the next normal
 * check-in). Plus: the calm banner shows only in backfill mode.
 */
describe('MorningCheckinWizard — F7 rattrapage mode', () => {
  it('renders the calm backfill banner for a past day', () => {
    render(<MorningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);
    expect(screen.getByText(/en retard/)).toBeInTheDocument();
  });

  it('does NOT show the banner in the normal (today) flow', () => {
    render(<MorningCheckinWizard today="2026-06-10" />);
    expect(screen.queryByText(/en retard/)).toBeNull();
  });

  it('never overwrites the today draft when opened in rattrapage mode (#1 F7 pitfall)', () => {
    const seeded = JSON.stringify({ date: '2026-06-10', intention: 'garder le plan' });
    window.localStorage.setItem(TODAY_DRAFT_KEY, seeded);

    render(<MorningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);

    // Rattrapage starts a fresh draft anchored to the backfilled day and never
    // touches the today key → the in-progress today draft stays byte-for-byte.
    expect(window.localStorage.getItem(TODAY_DRAFT_KEY)).toBe(seeded);
  });

  it('still persists the today draft in the normal flow (the guard is backfill-scoped)', () => {
    render(<MorningCheckinWizard today="2026-06-10" />);
    const raw = window.localStorage.getItem(TODAY_DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).date).toBe('2026-06-10');
  });
});

/**
 * F7 — closes the runtime-proof gap the headless browser pass could not reach:
 * the multi-step wizard's Suivant only advances once each step's REQUIRED field
 * is filled (so headless "Suivant does nothing" was expected validation, not a
 * bug). This drives the full 5 steps in jsdom to prove, deterministically, that
 * the justification textarea renders on the last step in rattrapage mode AND
 * that submitting it empty is BLOCKED (the server re-enforces via resolveBackfill,
 * but the client gate must hold too).
 */
describe('MorningCheckinWizard — F7 rattrapage justification gate (full drive)', () => {
  function advanceToLastStep() {
    // Step 1 (Sommeil) — sleepHours is required to advance.
    fireEvent.change(screen.getByLabelText('Heures de sommeil'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    // Step 2 (Routine) — both yes/no toggles required (non-null). Pick each via
    // its UNIQUE label (both groups also carry an ambiguous « Oui »).
    fireEvent.click(screen.getByRole('radio', { name: /Pas aujourd/ })); // routine → false
    fireEvent.click(screen.getByRole('radio', { name: /Pas encore/ })); // market → false
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    // Step 3 (Corps) — meditation defaults to "0" (valid), sport optional.
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    // Step 4 (Mental) — no required field.
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
  }

  it('renders the justification textarea on the last step and BLOCKS an empty submit', () => {
    render(<MorningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);
    advanceToLastStep();

    // Step 5 (Intention) — the rattrapage justification field is present.
    const justification = screen.getByLabelText(/Pourquoi ce rattrapage/);
    expect(justification).toBeInTheDocument();

    // Submitting with an empty justification is refused inline, action NOT called.
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer mon matin/ }));
    expect(screen.getByText(/Explique en une phrase/)).toBeInTheDocument();
    expect(vi.mocked(submitMorningCheckinAction)).not.toHaveBeenCalled();
  });

  it('submits once a justification is filled, forwarding it in the FormData', async () => {
    vi.mocked(submitMorningCheckinAction).mockResolvedValue({ ok: true });
    render(<MorningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);
    advanceToLastStep();

    fireEvent.change(screen.getByLabelText(/Pourquoi ce rattrapage/), {
      target: { value: 'Panne internet hier soir.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer mon matin/ }));

    await waitFor(() => expect(vi.mocked(submitMorningCheckinAction)).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(submitMorningCheckinAction).mock.calls[0]?.[1] as FormData;
    expect(fd.get('lateJustification')).toBe('Panne internet hier soir.');
    expect(fd.get('date')).toBe('2026-06-05');
  });
});
