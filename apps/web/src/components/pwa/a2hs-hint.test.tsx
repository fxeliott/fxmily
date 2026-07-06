// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { A2HSHint } from './a2hs-hint';

const STORAGE_KEY = 'fxmily.a2hs.dismissed';

/**
 * Build + dispatch a synthetic `beforeinstallprompt` with the Chromium-only
 * API surface the component consumes (`prompt`, `userChoice`, `platforms`).
 */
function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
    platforms: string[];
  };
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  event.platforms = ['web'];
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('A2HSHint', () => {
  it('ne rend rien tant que beforeinstallprompt n’a pas été capturé', () => {
    const { container } = render(<A2HSHint />);
    // iOS Safari path (event never fires) — the hint stays silent.
    expect(container.querySelector('[data-slot="a2hs-hint"]')).not.toBeInTheDocument();
  });

  it('affiche le hint après beforeinstallprompt (navigateur supporté)', async () => {
    render(<A2HSHint />);
    fireBeforeInstallPrompt();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /installer l'application/i })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /installer l'application fxmily/i }),
    ).toBeInTheDocument();
  });

  it('porte data-slot="a2hs-hint" (contrat du gating CSS vs cookie-banner)', async () => {
    // The P2 collision fix is a globals.css rule
    // `body:has([data-slot='cookie-banner']) [data-slot='a2hs-hint'] { display:none }`.
    // jsdom doesn't compute `:has()`, so the display:none is proven at runtime
    // (Chromium) — here we lock the DOM contract the rule depends on.
    render(<A2HSHint />);
    fireBeforeInstallPrompt();
    const region = await screen.findByRole('region', { name: /installer l'application/i });
    expect(region).toHaveAttribute('data-slot', 'a2hs-hint');
  });

  it('ne réapparaît pas si le flag de dismiss est déjà posé', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    render(<A2HSHint />);
    fireBeforeInstallPrompt();
    expect(
      screen.queryByRole('region', { name: /installer l'application/i }),
    ).not.toBeInTheDocument();
  });

  it('se ferme et persiste le dismiss au clic sur la croix', async () => {
    render(<A2HSHint />);
    fireBeforeInstallPrompt();
    const closeBtn = await screen.findByRole('button', { name: /fermer le hint/i });
    fireEvent.click(closeBtn);
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: /installer l'application/i }),
      ).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('déclenche le prompt natif et persiste le dismiss au clic sur « Installer »', async () => {
    render(<A2HSHint />);
    const event = fireBeforeInstallPrompt();
    const installBtn = await screen.findByRole('button', {
      name: /installer l'application fxmily/i,
    });
    fireEvent.click(installBtn);
    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('retire le hint quand l’app est installée (appinstalled)', async () => {
    render(<A2HSHint />);
    fireBeforeInstallPrompt();
    await screen.findByRole('region', { name: /installer l'application/i });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: /installer l'application/i }),
      ).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });
});
