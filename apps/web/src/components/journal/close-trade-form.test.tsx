// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P2 — input loss on a failed server validation (runtime-proven in prod).
 *
 * React 19 resets the <form> after a form action settles: UNCONTROLLED fields
 * are wiped back to their defaults while CONTROLLED fields survive (their value
 * re-derives from state on the post-action re-render). A member who submits an
 * invalid TradingView exit link must NOT lose the rest of the entry (exit
 * price, outcome, notes, the four self-evaluation radio groups).
 *
 * These tests pin every field as controlled by exercising the full round-trip:
 * fill → submit → mocked action rejects (`invalid_input`) → error alert
 * renders → every typed/selected value is still there.
 */

vi.mock('@/app/journal/actions', () => ({
  closeTradeAction: vi.fn(),
}));

import { closeTradeAction } from '@/app/journal/actions';

import { CloseTradeForm } from './close-trade-form';

const closeTradeActionMock = vi.mocked(closeTradeAction);

function renderForm() {
  return render(
    <CloseTradeForm
      tradeId="trade_1"
      enteredAtIso="2026-07-01T08:00:00.000Z"
      timezone="Europe/Paris"
    />,
  );
}

/** Fill every field the P2 audit proved lost + the already-controlled link. */
async function fillEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Prix de sortie'), '1.0842');
  fireEvent.click(screen.getByRole('radio', { name: 'Gain' }));
  await user.type(screen.getByLabelText('Notes (optionnel)'), 'Sortie propre au TP.');
  fireEvent.click(screen.getByRole('radio', { name: 'Oui, rien oublié' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Oui, selon ma règle' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Oui, BE à RR 1' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Oui, 90/10' }));
  await user.type(
    screen.getByLabelText('Lien TradingView de sortie'),
    'https://evil.example.com/x/abc/',
  );
}

function expectEntryRetained() {
  expect(screen.getByLabelText('Prix de sortie')).toHaveValue(1.0842);
  expect(screen.getByRole('radio', { name: 'Gain' })).toBeChecked();
  expect(screen.getByLabelText('Notes (optionnel)')).toHaveValue('Sortie propre au TP.');
  expect(screen.getByRole('radio', { name: 'Oui, rien oublié' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Oui, selon ma règle' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Oui, BE à RR 1' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Oui, 90/10' })).toBeChecked();
  // Regression guard — the link was already controlled pre-fix.
  expect(screen.getByLabelText('Lien TradingView de sortie')).toHaveValue(
    'https://evil.example.com/x/abc/',
  );
}

beforeEach(() => {
  closeTradeActionMock.mockReset();
  closeTradeActionMock.mockResolvedValue({
    ok: false,
    error: 'invalid_input',
    fieldErrors: { tradingViewExitUrl: 'Lien TradingView invalide.' },
  });
});

afterEach(() => {
  cleanup();
});

// Both tests type long strings through userEvent — zero inter-keystroke delay
// plus an explicit budget keeps them deterministic under full-suite worker
// load (they timed out at the 5s default with 306 sibling files running).
const LOAD_SAFE_TIMEOUT = 20_000;

describe('CloseTradeForm — P2 controlled fields (no input loss)', () => {
  it(
    'binds every self-report field to state (typed/selected value stays applied)',
    async () => {
      const user = userEvent.setup({ delay: null });
      renderForm();

      await fillEntry(user);
      expectEntryRetained();
    },
    LOAD_SAFE_TIMEOUT,
  );

  it(
    'keeps the whole entry after a FAILED server validation round-trip',
    async () => {
      const user = userEvent.setup({ delay: null });
      const { container } = renderForm();

      await fillEntry(user);

      // Programmatic submit — bypasses the submit gate (emotions are not the
      // subject here; they are controlled via EmotionPicker state already).
      const form = container.querySelector('form');
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      // The action ran and the server-style rejection surfaced.
      await waitFor(() => expect(closeTradeActionMock).toHaveBeenCalledTimes(1));
      await screen.findByText('Vérifie les champs en rouge.');

      // React 19 has reset the <form> by now — controlled fields must survive.
      expectEntryRetained();
    },
    LOAD_SAFE_TIMEOUT,
  );
});
