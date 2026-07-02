// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Framer Motion pass-through — same pattern as the morning wizard test (strip
// animation-only props so jsdom renders the final state synchronously).
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
  submitEveningCheckinAction: vi.fn(),
}));
vi.mock('@/lib/haptics', () => ({
  hapticTap: vi.fn(),
  hapticError: vi.fn(),
  hapticSuccess: vi.fn(),
}));

import { EveningCheckinWizard } from './evening-checkin-wizard';
import { submitEveningCheckinAction } from '@/app/checkin/actions';
import type { EveningCheckinPrefill } from '@/lib/checkin/prefill';

const TODAY_DRAFT_KEY = 'fxmily:checkin:evening:draft:v1';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

vi.setConfig({ testTimeout: 15000 });

function makeEveningPrefill(overrides: Partial<EveningCheckinPrefill> = {}): EveningCheckinPrefill {
  return {
    planRespectedToday: true,
    hedgeRespectedToday: 'false',
    intentionKept: 'true',
    formationFollowed: 'false',
    caffeineMl: '250',
    waterLiters: '2.5',
    stressScore: 4,
    moodScore: 7,
    emotionTags: ['calm', 'focused'],
    journalNote: 'Discipline tenue.',
    gratitudeItems: ['soleil', 'café', 'sport'],
    ...overrides,
  };
}

/**
 * Drive from step 1 (Discipline) to the last step (Réflexion). The prefill
 * seeds the two required discipline answers valid, so Suivant advances every
 * step without touching a control.
 */
function advanceToLastStepPrefilled() {
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // 1 → 2
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // 2 → 3
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // 3 → 4
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ })); // 4 → 5
}

describe('EveningCheckinWizard — F7 rattrapage mode', () => {
  it('renders the calm backfill banner for a past day', () => {
    render(<EveningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);
    expect(screen.getByText(/en retard/)).toBeInTheDocument();
  });

  it('does NOT show the banner in the normal (today) flow', () => {
    render(<EveningCheckinWizard today="2026-06-10" />);
    expect(screen.queryByText(/en retard/)).toBeNull();
  });

  it('never overwrites the today draft when opened in rattrapage mode (#1 F7 pitfall)', () => {
    const seeded = JSON.stringify({ date: '2026-06-10', journalNote: 'garder le plan' });
    window.localStorage.setItem(TODAY_DRAFT_KEY, seeded);
    render(<EveningCheckinWizard today="2026-06-10" backfillDate="2026-06-05" />);
    expect(window.localStorage.getItem(TODAY_DRAFT_KEY)).toBe(seeded);
  });
});

/**
 * P3 (#463 parity) — a submitted evening check-in must re-open SEEDED with its
 * answers (edit mode), not empty, and re-submitting must forward those exact
 * answers (explicit update) instead of blanking the row.
 */
describe('EveningCheckinWizard — P3 edit (prefill) mode', () => {
  it('swaps the submit CTA to an explicit "Mettre à jour" in edit mode', () => {
    render(<EveningCheckinWizard today="2026-07-02" prefill={makeEveningPrefill()} />);
    // Discipline is prefilled valid → Suivant advances without touching radios.
    advanceToLastStepPrefilled();
    expect(screen.getByRole('button', { name: /Mettre à jour ma soirée/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Enregistrer ma soirée/ })).toBeNull();
  });

  it('re-submits the prefilled answers (explicit update, not a blank overwrite)', async () => {
    // Reset call history: the file-level mock accumulates across tests (no
    // clearMocks in vitest.config), so assert against THIS render's call only.
    vi.mocked(submitEveningCheckinAction).mockClear();
    vi.mocked(submitEveningCheckinAction).mockResolvedValue({ ok: true });
    render(
      <EveningCheckinWizard
        today="2026-07-02"
        hasMorningIntention
        prefill={makeEveningPrefill()}
      />,
    );
    advanceToLastStepPrefilled();
    fireEvent.click(screen.getByRole('button', { name: /Mettre à jour ma soirée/ }));

    await waitFor(() => expect(vi.mocked(submitEveningCheckinAction)).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(submitEveningCheckinAction).mock.calls[0]?.[1] as FormData;
    expect(fd.get('date')).toBe('2026-07-02');
    expect(fd.get('planRespectedToday')).toBe('true');
    expect(fd.get('hedgeRespectedToday')).toBe('false');
    expect(fd.get('intentionKept')).toBe('true');
    expect(fd.get('stressScore')).toBe('4');
    expect(fd.get('journalNote')).toBe('Discipline tenue.');
    expect(fd.getAll('emotionTags')).toEqual(['calm', 'focused']);
    expect(fd.getAll('gratitudeItems')).toEqual(['soleil', 'café', 'sport']);
  });
});
