// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TradePsychologyTriad } from './trade-psychology-triad';

afterEach(cleanup);

describe('TradePsychologyTriad — arc avant/pendant/après (S4 §33 enrichissement #2)', () => {
  it('trade clôturé : les trois moments posés côte à côte avec leurs libellés FR', () => {
    render(
      <TradePsychologyTriad
        before={['calm']}
        during={['anxious']}
        after={['frustrated']}
        isClosed
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
    render(<TradePsychologyTriad before={['calm']} during={[]} after={[]} isClosed={false} />);
    expect(screen.getByText('Calme')).toBeInTheDocument();
    expect(screen.getAllByText('Se renseigne à la clôture')).toHaveLength(2);
  });

  it('trade clôturé avec moments vides : « Rien noté », pas un état d’attente', () => {
    render(<TradePsychologyTriad before={['calm']} during={[]} after={[]} isClosed />);
    expect(screen.getAllByText('Rien noté')).toHaveLength(2);
    expect(screen.queryByText('Se renseigne à la clôture')).not.toBeInTheDocument();
  });

  it('aucun moment renseigné : ne rend rien (parité avec les cartes d’origine)', () => {
    const { container } = render(
      <TradePsychologyTriad before={[]} during={[]} after={[]} isClosed />,
    );
    expect(container.firstChild).toBeNull();
  });

  // Posture §33.2 : descriptif, jamais punitif — aucun rouge même sur des émotions négatives.
  it('JAMAIS de rouge punitif (ni tone="bad", ni var(--bad))', () => {
    const { container } = render(
      <TradePsychologyTriad
        before={['fear-loss']}
        during={['revenge-trade']}
        after={['euphoric']}
        isClosed
      />,
    );
    expect(container.querySelectorAll('[data-tone="bad"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('var(--bad)');
  });
});
