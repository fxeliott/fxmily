// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MicroObjectiveView } from '@/lib/coaching/micro-objective';

// The card renders the `CloseMicroObjective` client island which references the
// server action. Mock it so this presentational test never pulls NextAuth/cache.
vi.mock('@/app/objectifs/actions', () => ({
  closeMicroObjectiveAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import { MicroObjectiveCard } from './micro-objective-card';

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

describe('MicroObjectiveCard — E3 boucle ouverte + suivi (S5 §32)', () => {
  it('renders nothing when no loop is open', () => {
    const { container } = render(<MicroObjectiveCard objective={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the open objective (title + intention) and tags its axis', () => {
    render(<MicroObjectiveCard objective={view()} />);
    const card = document.querySelector('[data-slot="micro-objective-card"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-axis')).toBe('discipline');
    expect(screen.getByText('Tenir ta routine, un jour à la fois')).toBeInTheDocument();
    expect(screen.getByText(/remplis ton bilan/)).toBeInTheDocument();
  });

  it('offers the three calm follow-up choices in a labelled group (a11y)', () => {
    render(<MicroObjectiveCard objective={view()} />);
    expect(screen.getByRole('group', { name: /tenu ton micro-objectif/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /je l’ai tenu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pas encore/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pas pertinent/i })).toBeInTheDocument();
  });

  it('§31.2 — "pas encore" (missed) is never a danger/red control', () => {
    render(<MicroObjectiveCard objective={view()} />);
    const missed = screen.getByRole('button', { name: /pas encore/i });
    expect(missed.className).not.toMatch(/danger|bad|--bad/i);
  });
});
