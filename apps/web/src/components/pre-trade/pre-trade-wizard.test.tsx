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

import type { CorrelationByReason } from '@/lib/pre-trade/correlation';

import { buildReasonMirror, PreTradeCheckWizard } from './pre-trade-wizard';

const SAMPLE_CORRELATION: CorrelationByReason = {
  edge: {
    kind: 'ok',
    sampleSize: 12,
    winRate: 0.5,
    lossRate: 0.33,
    breakEvenRate: 0.17,
    avgRealizedR: 0.8,
    avgRSampleSize: 10,
  },
  fomo: {
    kind: 'ok',
    sampleSize: 10,
    winRate: 0.3,
    lossRate: 0.6,
    breakEvenRate: 0.1,
    avgRealizedR: -0.4,
    avgRSampleSize: 9,
  },
  revenge: { kind: 'insufficient_data', sampleSize: 3, reason: 'below_threshold' },
  boredom: { kind: 'insufficient_data', sampleSize: 0, reason: 'no_linked_trades' },
};

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

describe('buildReasonMirror — fact-only empirical mirror (posture §2)', () => {
  it('formats an ok bucket as a fact with win/loss/avgR, no verdict', () => {
    const content = buildReasonMirror(SAMPLE_CORRELATION.fomo, 'Peur de rater', 30);
    expect(content.tone).toBe('fact');
    expect(content.text).toBe(
      'Sur tes 10 trades « peur de rater » des 30 derniers jours : 30% gagnants · 60% perdants · -0.4R en moyenne (n=9).',
    );
    // Never a directive — pure mirror.
    expect(content.text).not.toMatch(/évite|arrête|ne prends pas|conseil/i);
  });

  it('omits the R magnitude when no computed realizedR is available', () => {
    const content = buildReasonMirror(
      {
        kind: 'ok',
        sampleSize: 9,
        winRate: 0.44,
        lossRate: 0.44,
        breakEvenRate: 0.12,
        avgRealizedR: null,
        avgRSampleSize: 0,
      },
      'Edge / setup éprouvé',
      30,
    );
    expect(content.text).toContain('44% gagnants');
    expect(content.text).not.toContain('R en moyenne');
  });

  it('shows honest progress (never a fabricated rate) below the sample floor', () => {
    const content = buildReasonMirror(SAMPLE_CORRELATION.revenge, 'Compenser une perte', 30);
    expect(content.tone).toBe('pending');
    expect(content.text).toBe(
      "Encore 5 trades « compenser une perte » reliés et ton miroir s'affichera (3/8).",
    );
  });

  it('handles the zero-linked-trades case without inventing a number', () => {
    const content = buildReasonMirror(
      SAMPLE_CORRELATION.boredom,
      'Envie de faire quelque chose',
      30,
    );
    expect(content.tone).toBe('pending');
    expect(content.text).toContain('Aucun trade « envie de faire quelque chose » relié');
  });
});

describe('PreTradeCheckWizard — empirical mirror at the decision moment (Session 21)', () => {
  it('surfaces the member’s own loss rate the instant a risk reason is picked', () => {
    render(<PreTradeCheckWizard correlation={SAMPLE_CORRELATION} correlationWindowDays={30} />);
    // No mirror before a choice.
    expect(screen.queryByText(/Ton miroir empirique/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Peur de rater/ }));
    expect(screen.getByText(/Ton miroir empirique/)).toBeInTheDocument();
    expect(screen.getByText(/60% perdants/)).toBeInTheDocument();
  });

  it('shows the honest "not enough data" note for a below-threshold reason', () => {
    render(<PreTradeCheckWizard correlation={SAMPLE_CORRELATION} correlationWindowDays={30} />);
    fireEvent.click(screen.getByRole('radio', { name: /Compenser une perte/ }));
    expect(screen.getByText(/Encore 5 trades/)).toBeInTheDocument();
    expect(screen.queryByText(/Ton miroir empirique/)).not.toBeInTheDocument();
  });

  it('renders no mirror when correlation data is unavailable (degraded load)', () => {
    render(<PreTradeCheckWizard />);
    fireEvent.click(screen.getByRole('radio', { name: /Peur de rater/ }));
    expect(document.querySelector('[data-slot="reason-mirror"]')).toBeNull();
  });
});
