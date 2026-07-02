// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminLatestMessages } from '@/lib/seances/admin-service';

import { SeanceDiscordPanel } from './seance-discord-panel';

/**
 * Réunion hub (séances) — le retour de copie du panneau admin ne doit JAMAIS
 * être silencieux (parité avec le hub statique `src/assets/js/admin.js`). On
 * prouve les 3 chemins de `writeToClipboard` : API async OK, repli
 * `execCommand`, et échec total → « Copie impossible » + annonce `aria-live`.
 */

const LATEST: AdminLatestMessages = {
  date: '2026-07-01',
  slot: 'analyse',
  title: 'Analyse — mercredi 1 juillet',
  messages: [
    { asset: 'GER40', text: 'Biais long GER40, niveau 18500.' },
    { asset: 'DXY', text: 'DXY neutre, range 104-105.' },
  ],
};

const writeText = vi.fn();

/** Remplace `navigator.clipboard` (own property → shadow le stub jsdom). */
function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

const ger40Button = (): HTMLElement =>
  screen.getByRole('button', { name: 'Copier le message GER40' });

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  setClipboard({ writeText });
  // jsdom n'implémente pas execCommand — stub par défaut (échec), surchargé au besoin.
  document.execCommand = vi.fn(() => false);
});

afterEach(() => {
  // Purge le timer d'auto-reset (2s/4s) DANS act pour ne rien laisser pendre.
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('SeanceDiscordPanel — retour de copie jamais silencieux (parité hub)', () => {
  it('rend chaque message + son bouton Copier (0 emoji, 0 mention IA)', () => {
    render(<SeanceDiscordPanel latest={LATEST} />);
    expect(screen.getByText('GER40')).toBeInTheDocument();
    expect(screen.getByText('Biais long GER40, niveau 18500.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Copier le message/ })).toHaveLength(2);
  });

  it('succès API : bascule sur « Copié » et annonce la réussite (aria-live)', async () => {
    writeText.mockResolvedValue(undefined);
    render(<SeanceDiscordPanel latest={LATEST} />);

    await act(async () => {
      fireEvent.click(ger40Button());
    });

    expect(writeText).toHaveBeenCalledWith('Biais long GER40, niveau 18500.');
    expect(ger40Button()).toHaveTextContent('Copié');
    expect(screen.getByText('Message GER40 copié')).toBeInTheDocument();
  });

  it('échec total (API refusée + repli KO) : « Copie impossible » + annonce — jamais silencieux', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    document.execCommand = vi.fn(() => false);
    render(<SeanceDiscordPanel latest={LATEST} />);

    await act(async () => {
      fireEvent.click(ger40Button());
    });

    expect(ger40Button()).toHaveTextContent('Copie impossible');
    expect(ger40Button()).not.toHaveTextContent('Copié');
    expect(
      screen.getByText(
        /Copie impossible du message GER40\. Sélectionne le texte et fais Ctrl\+C\./,
      ),
    ).toBeInTheDocument();
  });

  it('repli execCommand : récupère la copie quand l’API async est refusée (→ « Copié »)', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    render(<SeanceDiscordPanel latest={LATEST} />);

    await act(async () => {
      fireEvent.click(ger40Button());
    });

    expect(exec).toHaveBeenCalledWith('copy');
    expect(ger40Button()).toHaveTextContent('Copié');
  });

  it('API absente : passe directement par le repli, sans jamais appeler writeText', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => true);
    render(<SeanceDiscordPanel latest={LATEST} />);

    await act(async () => {
      fireEvent.click(ger40Button());
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(ger40Button()).toHaveTextContent('Copié');
  });
});
