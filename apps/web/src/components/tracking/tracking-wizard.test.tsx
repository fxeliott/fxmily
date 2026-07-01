// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2 S2 — DoD#6 "Aucun QCM/test ne casse sur aucun écran — 0 bug". The universal
 * tracking engine DECLARES six question kinds (`types.ts` `TrackingQuestion`) and
 * the data layer (Zod `buildResponsesSchema`, the server action's response
 * rebuild) already handles all six — but the only SHIPPED instrument
 * (`process-fidelity` v1) exercises just three (boolean / likert / single_choice).
 * The two unexercised kinds — `multi_tag` and `numeric` — therefore had NO render
 * coverage: a future instrument using them would have hit the wizard's dead
 * "Type de question non pris en charge" fallback and shipped green.
 *
 * This RTL test pins the wizard against a synthetic instrument that uses ALL SIX
 * kinds at once, so the engine is universal IN FACT (not just in its type union):
 *   - every kind renders a real, interactive field (no "non pris en charge");
 *   - `multi_tag` is an APG toggle-button group that enforces `maxSelected`;
 *   - `numeric` is a bounded spinbutton;
 *   - the hidden-input payload serialises exactly what the server action rebuilds
 *     (`multi_tag` → JSON array string, `numeric` → number string);
 *   - the submit unlocks only once every required answer + the D3 confidence
 *     scale is provided.
 */

vi.mock('@/app/tracking/[instrument]/actions', () => ({
  submitTrackingInstrumentAction: vi.fn(async (_prev: unknown, _formData: FormData) => null),
}));

import type { TrackingInstrument } from '@/lib/tracking/types';

import { TrackingWizard } from './tracking-wizard';

/** Synthetic instrument exercising all six question kinds + the confidence scale. */
const ALL_KINDS: TrackingInstrument = {
  key: 'test-all-kinds',
  version: 'v1',
  axis: 'emotions_confidence',
  title: 'Test — tous les types de questions',
  preamble: 'Un repère, pas un jugement.',
  cadence: { kind: 'manual' },
  defaultCaptureContext: 'cold',
  capturesConfidence: true,
  questions: [
    { id: 'b1', kind: 'boolean', label: 'As-tu coupé à 20h ?' },
    {
      id: 'l1',
      kind: 'likert',
      label: 'À quelle fréquence as-tu respecté ton plan ?',
      anchors: [
        { value: 1, label: 'Jamais' },
        { value: 2, label: 'Rarement' },
        { value: 3, label: 'Parfois' },
        { value: 4, label: 'Souvent' },
        { value: 5, label: 'Toujours' },
      ],
    },
    {
      id: 's1',
      kind: 'scale',
      label: 'Niveau de calme ressenti',
      min: 1,
      max: 5,
      minLabel: 'Faible',
      maxLabel: 'Élevé',
    },
    {
      id: 'sc1',
      kind: 'single_choice',
      label: 'Quel moment de la séance ?',
      options: [
        { value: 'open', label: 'Ouverture' },
        { value: 'mid', label: 'Milieu' },
      ],
    },
    {
      id: 'mt1',
      kind: 'multi_tag',
      label: "Coche tout ce qui s'applique",
      options: [
        { value: 'calme', label: 'Calme' },
        { value: 'stress', label: 'Stress' },
        { value: 'fatigue', label: 'Fatigue' },
      ],
      maxSelected: 2,
    },
    {
      id: 'n1',
      kind: 'numeric',
      label: 'Heures de sommeil',
      min: 0,
      max: 24,
      unit: 'h',
      integer: true,
    },
  ],
};

const OCCURRENCE = 'test-occurrence';

function hidden(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
  if (!el) throw new Error(`hidden input "${name}" not found`);
  return el;
}

/** Answer every radiogroup (boolean / likert / scale / single_choice / confidence)
 *  by clicking its first radio. Re-queries before each click — every state change
 *  re-renders the wizard, so a captured node would be stale. */
function answerAllRadiogroups() {
  const count = screen.getAllByRole('radiogroup').length;
  for (let i = 0; i < count; i++) {
    const group = screen.getAllByRole('radiogroup')[i]!;
    fireEvent.click(within(group).getAllByRole('radio')[0]!);
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('TrackingWizard — universal engine renders all six question kinds (DoD#6)', () => {
  it('renders every kind as a real field, never the "non pris en charge" fallback', () => {
    render(<TrackingWizard instrument={ALL_KINDS} occurrenceKey={OCCURRENCE} />);

    // The dead fallback must never appear — all six kinds are handled.
    expect(screen.queryByText(/non pris en charge/i)).toBeNull();

    // boolean → Oui/Non radios.
    expect(screen.getByRole('radio', { name: 'Oui' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Non' })).toBeInTheDocument();
    // likert → anchored radios ("1 — Jamais" … "5 — Toujours").
    expect(screen.getByRole('radio', { name: /^1 · Jamais/ })).toBeInTheDocument();
    // scale → extremes labelled.
    expect(screen.getByRole('radio', { name: /^1 · Faible/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^5 · Élevé/ })).toBeInTheDocument();
    // single_choice → option labels.
    expect(screen.getByRole('radio', { name: 'Ouverture' })).toBeInTheDocument();
    // multi_tag → a labelled group of toggle buttons (aria-pressed).
    const tagGroup = screen.getByRole('group', { name: /Coche tout ce qui s'applique/ });
    expect(within(tagGroup).getByRole('button', { name: 'Calme' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // numeric → a bounded spinbutton.
    const spin = screen.getByRole('spinbutton');
    expect(spin).toHaveAttribute('min', '0');
    expect(spin).toHaveAttribute('max', '24');
  });

  it('multi_tag enforces maxSelected and is otherwise togglable', () => {
    const { container } = render(
      <TrackingWizard instrument={ALL_KINDS} occurrenceKey={OCCURRENCE} />,
    );

    const calme = screen.getByRole('button', { name: 'Calme' });
    const stress = screen.getByRole('button', { name: 'Stress' });
    const fatigue = screen.getByRole('button', { name: 'Fatigue' });

    fireEvent.click(calme);
    expect(screen.getByRole('button', { name: 'Calme' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(stress);
    // Cap reached (2/2) — the live counter reflects it and the third is blocked.
    expect(screen.getByText(/2\/2 sélectionnés · maximum atteint/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fatigue' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Clicking the blocked tag is a no-op (still not pressed, still 2/2).
    fireEvent.click(screen.getByRole('button', { name: 'Fatigue' }));
    expect(screen.getByRole('button', { name: 'Fatigue' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(/2\/2 sélectionnés · maximum atteint/)).toBeInTheDocument();

    // The hidden payload is the JSON array the server action JSON.parses back.
    expect(hidden(container, 'mt1').value).toBe(JSON.stringify(['calme', 'stress']));

    // Deselecting back to empty stores '' (unanswered), never the literal "[]".
    fireEvent.click(screen.getByRole('button', { name: 'Calme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stress' }));
    expect(hidden(container, 'mt1').value).toBe('');
    void fatigue;
  });

  it('numeric writes the typed value straight into the hidden payload', () => {
    const { container } = render(
      <TrackingWizard instrument={ALL_KINDS} occurrenceKey={OCCURRENCE} />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
    expect(hidden(container, 'n1').value).toBe('8');
  });

  it('unlocks submit only once every required answer + confidence is given', () => {
    render(<TrackingWizard instrument={ALL_KINDS} occurrenceKey={OCCURRENCE} />);

    const submit = () => screen.getByRole('button', { name: /Enregistrer mon suivi/ });
    expect(submit()).toBeDisabled();

    // Answer the five radiogroups (boolean/likert/scale/single_choice/confidence)…
    answerAllRadiogroups();
    // …a multi_tag selection…
    fireEvent.click(screen.getByRole('button', { name: 'Calme' }));
    // …still gated until the required numeric is filled.
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });

    expect(submit()).toBeEnabled();
  });
});
