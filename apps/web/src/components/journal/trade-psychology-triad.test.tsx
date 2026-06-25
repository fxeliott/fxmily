// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TradePsychologyTriad } from './trade-psychology-triad';

afterEach(cleanup);

describe('TradePsychologyTriad — parcours avant/pendant/après (S4 §33 enrichissement #2)', () => {
  it('trade clôturé : les trois moments posés côte à côte avec leurs libellés FR', () => {
    render(
      <TradePsychologyTriad
        before={['calm']}
        during={['anxious']}
        after={['frustrated']}
        isClosed
        pair="EURUSD"
      />,
    );
    expect(screen.getByText('Avant')).toBeInTheDocument();
    expect(screen.getByText('Pendant')).toBeInTheDocument();
    expect(screen.getByText('Après')).toBeInTheDocument();
    expect(screen.getByText('Calme')).toBeInTheDocument();
    expect(screen.getByText('Anxiété')).toBeInTheDocument();
    expect(screen.getByText('Frustration')).toBeInTheDocument();
  });

  it('trade ouvert : pendant/après en attente de clôture (jamais « manquant »)', () => {
    render(
      <TradePsychologyTriad
        before={['calm']}
        during={[]}
        after={[]}
        isClosed={false}
        pair="EURUSD"
      />,
    );
    expect(screen.getByText('Calme')).toBeInTheDocument();
    expect(screen.getAllByText('Se renseigne à la clôture')).toHaveLength(2);
  });

  it('trade clôturé avec moments vides : « Rien noté », pas un état d’attente', () => {
    render(
      <TradePsychologyTriad before={['calm']} during={[]} after={[]} isClosed pair="EURUSD" />,
    );
    expect(screen.getAllByText('Rien noté')).toHaveLength(2);
    expect(screen.queryByText('Se renseigne à la clôture')).not.toBeInTheDocument();
  });

  it('aucun moment renseigné : ne rend rien (parité avec les cartes d’origine)', () => {
    const { container } = render(
      <TradePsychologyTriad before={[]} during={[]} after={[]} isClosed pair="EURUSD" />,
    );
    expect(container.firstChild).toBeNull();
  });

  // E2-1 — la capture entrée/sortie rejoint le bon moment de l'arc (rapprochée).
  it('rapproche les captures : entrée → Avant, sortie → Après (liens zoom)', () => {
    render(
      <TradePsychologyTriad
        before={['calm']}
        during={[]}
        after={['frustrated']}
        isClosed
        pair="EURUSD"
        entryPhotoUrl="https://example.test/entry.png"
        exitPhotoUrl="https://example.test/exit.png"
      />,
    );
    const entry = screen.getByAltText('Capture avant entrée du trade EURUSD');
    const exit = screen.getByAltText('Capture après sortie du trade EURUSD');
    expect(entry).toHaveAttribute('src', 'https://example.test/entry.png');
    expect(exit).toHaveAttribute('src', 'https://example.test/exit.png');
  });

  // E2-2 — l'intention d'entrée et le débrief de sortie, étiquetés et séparés.
  it('rapproche l’écrit : « Avant le trade » + « Débrief » étiquetés', () => {
    render(
      <TradePsychologyTriad
        before={['calm']}
        during={[]}
        after={['focused']}
        isClosed
        pair="EURUSD"
        entryNote="Range Londres, j'attends le retest."
        debrief="TP touché, plan tenu."
      />,
    );
    expect(screen.getByText('Avant le trade')).toBeInTheDocument();
    expect(screen.getByText("Range Londres, j'attends le retest.")).toBeInTheDocument();
    expect(screen.getByText('Débrief')).toBeInTheDocument();
    expect(screen.getByText('TP touché, plan tenu.')).toBeInTheDocument();
  });

  // Le bloc apparaît même SANS émotion, dès qu'une capture ou un écrit existe.
  it('rend l’arc même sans émotion si une capture ou un écrit existe', () => {
    const { container } = render(
      <TradePsychologyTriad
        before={[]}
        during={[]}
        after={[]}
        isClosed
        pair="EURUSD"
        debrief="Juste un débrief."
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText('Débrief')).toBeInTheDocument();
    expect(screen.getByText('Juste un débrief.')).toBeInTheDocument();
  });

  // Posture §33.2 : descriptif, jamais punitif — aucun rouge même sur des émotions négatives.
  it('JAMAIS de rouge punitif (ni tone="bad", ni var(--bad))', () => {
    const { container } = render(
      <TradePsychologyTriad
        before={['fear-loss']}
        during={['revenge-trade']}
        after={['euphoric']}
        isClosed
        pair="EURUSD"
      />,
    );
    expect(container.querySelectorAll('[data-tone="bad"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('var(--bad)');
  });
});
