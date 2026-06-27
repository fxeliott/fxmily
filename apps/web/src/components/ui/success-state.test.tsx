// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SuccessState } from './success-state';

/**
 * S9 RC#2 — contrat runtime de la primitive `SuccessState` (4e état vivant
 * §33bis-2). On prouve le contrat structurel sur lequel les surfaces s'appuient :
 *  - annonce assistive : `role="status"` (⇒ aria-live polite) porte le headline ;
 *  - le corps optionnel s'affiche quand fourni, est absent sinon ;
 *  - `data-slot` + icône par défaut présents ; les variantes `size` changent le
 *    padding sans casser le rôle.
 */
afterEach(() => {
  cleanup();
});

describe('SuccessState', () => {
  it('expose un role="status" portant le headline (annonce assistive)', () => {
    render(<SuccessState headline="Trade enregistré." />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('Trade enregistré.');
    expect(status).toHaveAttribute('data-slot', 'success-state');
  });

  it('rend le corps optionnel quand fourni', () => {
    render(<SuccessState headline="Enregistré">C&apos;est posé. Reviens demain.</SuccessState>);
    expect(screen.getByText(/Reviens demain/)).toBeInTheDocument();
  });

  it("n'a aucun paragraphe de corps sans children", () => {
    const { container } = render(<SuccessState headline="Seul le titre" />);
    // headline = 1 <p> ; pas de second paragraphe de corps.
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('affiche une icône décorative (aria-hidden) par défaut', () => {
    const { container } = render(<SuccessState headline="Avec coche" />);
    const icon = container.querySelector('[aria-hidden] svg');
    expect(icon).toBeInTheDocument();
  });

  it('applique le padding bloc en taille "block"', () => {
    render(<SuccessState size="block" headline="Bloc" />);
    expect(screen.getByRole('status').className).toContain('p-4');
  });

  it('applique le padding inline par défaut', () => {
    render(<SuccessState headline="Inline" />);
    const cls = screen.getByRole('status').className;
    expect(cls).toContain('px-4');
    expect(cls).toContain('py-3');
  });
});
