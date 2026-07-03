// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MicroObjectiveCloseEcho } from '@/lib/coaching/micro-objective';

const closeAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/objectifs/actions', () => ({ closeMicroObjectiveAction: closeAction }));

import { CloseMicroObjective } from './close-micro-objective';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const KEPT_ECHO: MicroObjectiveCloseEcho = {
  tone: 'ok',
  lines: [
    "Tu l'as tenu. C'est la répétition de ce geste qui construit ta constance.",
    'Un pas de plus dans la bonne direction, garde ce cap.',
  ],
};

describe('CloseMicroObjective — Tour 11 FINDING 1 (close echo)', () => {
  it('shows the three calm choices before any close', () => {
    closeAction.mockResolvedValue({ ok: true });
    render(<CloseMicroObjective microObjectiveId="obj1" />);
    expect(screen.getByRole('group', { name: /tenu ton micro-objectif/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /je l’ai tenu/i })).toBeInTheDocument();
  });

  it('on success renders the echo in a polite live region and hides the choices', async () => {
    closeAction.mockResolvedValue({ ok: true, echo: KEPT_ECHO });
    const user = userEvent.setup();
    render(<CloseMicroObjective microObjectiveId="obj1" />);

    await user.click(screen.getByRole('button', { name: /je l’ai tenu/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/répétition de ce geste qui construit ta constance/);
    expect(status).toHaveTextContent('Boucle refermée');
    // The echo survives the (mocked) re-render — the choice buttons are gone.
    expect(
      screen.queryByRole('group', { name: /tenu ton micro-objectif/i }),
    ).not.toBeInTheDocument();
    // §31.2 — the confirmation is never red / danger toned.
    expect(status.className).not.toMatch(/--bad|danger/i);
    expect(status.getAttribute('data-tone')).toBe('ok');
  });

  it('on success WITHOUT an echo keeps the choices (defensive, no crash)', async () => {
    closeAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<CloseMicroObjective microObjectiveId="obj1" />);

    await user.click(screen.getByRole('button', { name: /pas encore/i }));

    await waitFor(() => expect(closeAction).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /tenu ton micro-objectif/i })).toBeInTheDocument();
  });

  it('on failure surfaces a retry alert (unchanged behaviour)', async () => {
    closeAction.mockResolvedValue({ ok: false, error: 'unknown' });
    const user = userEvent.setup();
    render(<CloseMicroObjective microObjectiveId="obj1" />);

    await user.click(screen.getByRole('button', { name: /pas pertinent/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/impossible/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
