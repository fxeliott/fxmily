// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MicroObjectiveView } from '@/lib/coaching/micro-objective';

// The loop renders the `CloseMicroObjective` island which references the server
// action. Mock it so this test never pulls NextAuth/next-cache — and make it
// return an echo, like the real action does on success.
vi.mock('@/app/objectifs/actions', () => ({
  closeMicroObjectiveAction: vi.fn().mockResolvedValue({
    ok: true,
    echo: {
      tone: 'ok',
      lines: ['Boucle tenue.', 'Le geste compte plus que le résultat du jour.'],
    },
  }),
}));

import { MicroObjectiveLoop } from './micro-objective-loop';

/**
 * Tour 11 (FINDING 1, fix runtime) — regression pin for the RSC unmount bug:
 * `closeMicroObjectiveAction` revalidates the pages, the next server render
 * passes `objective={null}`, and an echo held INSIDE the card dies unseen.
 * The loop island owns the echo and must keep it visible through that exact
 * prop transition (open view → null).
 */

afterEach(cleanup);

function view(over: Partial<MicroObjectiveView> = {}): MicroObjectiveView {
  return {
    id: 'obj1',
    axis: 'discipline',
    title: 'Tenir ta routine, un jour à la fois',
    intention: 'Ce soir, remplis ton bilan — même en une seule ligne.',
    status: 'open',
    sourceKind: 'alert',
    sourceRef: 'a1',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    closedAt: null,
    ...over,
  };
}

describe('MicroObjectiveLoop — always-mounted echo owner (tour 11 FINDING 1)', () => {
  it('renders nothing when no loop is open and nothing was closed', () => {
    const { container } = render(<MicroObjectiveLoop objective={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the open card (passthrough props) while the loop is open', () => {
    render(<MicroObjectiveLoop objective={view()} isStale />);
    expect(screen.getByText('Tenir ta routine, un jour à la fois')).toBeInTheDocument();
    expect(screen.getByText(/Toujours d’actualité/)).toBeInTheDocument();
  });

  it('keeps the close echo visible AFTER the RSC re-render drops the objective', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MicroObjectiveLoop objective={view()} />);

    await user.click(screen.getByRole('button', { name: /je l’ai tenu/i }));

    // The echo shows immediately (card replaced by the mirror of the act)…
    expect(await screen.findByRole('status')).toHaveTextContent('Boucle tenue.');

    // …and SURVIVES the revalidation: the server now passes `objective={null}`.
    rerender(<MicroObjectiveLoop objective={null} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Boucle refermée');
    expect(status).toHaveTextContent('Boucle tenue.');
    // The buttons are gone — the loop is closed, no ghost controls.
    expect(screen.queryByRole('button', { name: /je l’ai tenu/i })).not.toBeInTheDocument();
  });

  it('a NEW open loop replaces the stale echo with the fresh card', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MicroObjectiveLoop objective={view()} />);
    await user.click(screen.getByRole('button', { name: /je l’ai tenu/i }));
    await screen.findByRole('status');
    rerender(<MicroObjectiveLoop objective={null} />);

    // Later, a different loop opens (e.g. seeded by the coach).
    rerender(
      <MicroObjectiveLoop
        objective={view({ id: 'obj2', title: 'Respirer avant chaque entrée' })}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Respirer avant chaque entrée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /je l’ai tenu/i })).toBeInTheDocument();
  });
});
