// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DriftAlertsCard } from './drift-alerts-card';
import type { AlertView } from '@/lib/verification/alerts';

afterEach(cleanup);

const ALERT = (over: Partial<AlertView> = {}): AlertView => ({
  id: 'a1',
  triggerType: 'false_declaration_repeat',
  label: 'Fausses déclarations répétées',
  repeatCount: 2,
  threshold: 2,
  status: 'delivered',
  createdAt: new Date('2026-06-10T08:00:00.000Z'),
  ...over,
});

describe('DriftAlertsCard — surface membre des alertes de dérive (S4 §33/§34)', () => {
  it('liste vide : état rassurant, jamais alarmant', () => {
    render(<DriftAlertsCard alerts={[]} />);
    expect(screen.getByText(/Aucune alerte de dérive/)).toBeInTheDocument();
  });

  it('liste pleine : libellé + occurrences affichés', () => {
    render(<DriftAlertsCard alerts={[ALERT()]} />);
    expect(screen.getByText('Fausses déclarations répétées')).toBeInTheDocument();
    expect(screen.getByText(/répété 2 fois/)).toBeInTheDocument();
  });

  it('mapping statut → libellé calme (delivered/open/dismissed)', () => {
    render(
      <DriftAlertsCard
        alerts={[
          ALERT({ id: 'd', status: 'delivered' }),
          ALERT({ id: 'o', status: 'open' }),
          ALERT({ id: 'x', status: 'dismissed' }),
        ]}
      />,
    );
    expect(screen.getByText('Fiche envoyée')).toBeInTheDocument();
    expect(screen.getByText('En préparation')).toBeInTheDocument();
    expect(screen.getByText('Classé')).toBeInTheDocument();
  });

  // Posture §33.2 (anti Black-Hat, BLOQUANT) : aucun rouge punitif, dans AUCUN état.
  it('JAMAIS de rouge punitif (ni tone="bad", ni var(--bad)) — empty + plein', () => {
    for (const alerts of [
      [] as AlertView[],
      [
        ALERT({ id: 'd', status: 'delivered' }),
        ALERT({ id: 'o', status: 'open' }),
        ALERT({ id: 'x', status: 'dismissed' }),
      ],
    ]) {
      const { container } = render(<DriftAlertsCard alerts={alerts} />);
      expect(container.querySelectorAll('[data-tone="bad"]')).toHaveLength(0);
      expect(container.innerHTML).not.toContain('var(--bad)');
      cleanup();
    }
  });
});
