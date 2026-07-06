// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The component lazy-imports `@sentry/nextjs` in a useEffect. Stub it so the
// dynamic import resolves in jsdom (no real SDK, no network).
const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock }));

import { RouteSegmentError } from './route-segment-error';

afterEach(() => {
  cleanup();
  captureExceptionMock.mockReset();
});

/**
 * Tour 15 — contract of the shared premium error / not-found surface that all
 * ~21 segment boundaries now wrap. We prove the structural guarantees callers
 * depend on: the headline renders, `reset()` fires from the retry button, the
 * not-found variant offers no retry, and the digest surfaces for support.
 */
describe('RouteSegmentError', () => {
  it('rend le headline contextuel dans un h1', () => {
    render(<RouteSegmentError headline="Ton journal n'a pas pu s'afficher" reset={() => {}} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent("Ton journal n'a pas pu s'afficher");
  });

  it('appelle reset() au clic sur « Réessayer » (variante error)', () => {
    const reset = vi.fn();
    render(<RouteSegmentError headline="Cassé" reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('affiche l’identifiant digest quand fourni', () => {
    render(
      <RouteSegmentError
        headline="Cassé"
        reset={() => {}}
        error={{ name: 'E', message: 'm', digest: 'abc123' }}
      />,
    );
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('capture l’erreur via Sentry en variante error', async () => {
    const error = { name: 'E', message: 'boom', digest: 'd1' } as Error & { digest?: string };
    render(<RouteSegmentError headline="Cassé" reset={() => {}} error={error} />);
    // The capture runs in a useEffect via a dynamic import (microtask).
    await waitFor(() => expect(captureExceptionMock).toHaveBeenCalledWith(error));
  });

  it('variante not-found : pas de bouton Réessayer, expose la nav de retour', () => {
    render(<RouteSegmentError variant="not-found" headline="Page introuvable" />);
    expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument();
    // Way-back links (dashboard + home) are present as anchors.
    expect(screen.getByRole('link', { name: /tableau de bord/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /accueil/i })).toBeInTheDocument();
  });

  it('variante not-found : ne rapporte rien à Sentry (état attendu)', () => {
    render(<RouteSegmentError variant="not-found" headline="Page introuvable" />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('porte le data-slot + data-variant pour le ciblage CSS/audit', () => {
    const { container } = render(<RouteSegmentError headline="Cassé" reset={() => {}} />);
    const root = container.querySelector('[data-slot="route-segment-error"]');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-variant', 'error');
  });
});
