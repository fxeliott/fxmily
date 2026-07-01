// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
