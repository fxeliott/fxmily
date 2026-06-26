// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CoachingInsight } from '@/lib/coaching/engine';

import { CoachingInsightCard } from './coaching-insight-card';

afterEach(cleanup);

function insight(over: Partial<CoachingInsight> = {}): CoachingInsight {
  return {
    axis: 'discipline',
    tone: 'alert',
    headline: 'Ton focus mental : la discipline',
    observation: 'Plusieurs journées sans suivi, sans motif (×3).',
    meaning: 'Éviter de regarder son travail, c’est souvent éviter une vérité inconfortable.',
    nextStep: 'Ce soir, remplis ton bilan — même en une seule ligne.',
    progression: {
      label: 'Micro-objectifs tenus',
      value: 75,
      unit: '%',
      trend: 'up',
      detail: '3 tenus sur 4 refermés',
    },
    basis: ['Alerte « bilans oubliés »', 'Constance 72/100', '2 boucles refermées'],
    ...over,
  };
}

describe('CoachingInsightCard — surface S4 (S5 §32-C/D)', () => {
  it('rend null sans insight (jamais une carte fabriquée)', () => {
    const { container } = render(<CoachingInsightCard insight={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('affiche la synthèse cause → effet → prochain pas', () => {
    render(<CoachingInsightCard insight={insight()} />);
    expect(document.querySelector('[data-slot="coaching-insight-card"]')).not.toBeNull();
    expect(screen.getByText('Ton focus mental : la discipline')).toBeInTheDocument();
    expect(screen.getByText(/Plusieurs journées sans suivi/)).toBeInTheDocument();
    expect(screen.getByText('Ce que ça veut dire')).toBeInTheDocument();
    expect(screen.getByText('Ton prochain pas')).toBeInTheDocument();
    expect(screen.getByText(/remplis ton bilan/)).toBeInTheDocument();
  });

  it('affiche la progression MESURÉE (valeur + unité + détail)', () => {
    render(<CoachingInsightCard insight={insight()} />);
    const block = document.querySelector('[data-slot="coaching-progression"]');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('Micro-objectifs tenus');
    expect(block?.textContent).toContain('75');
    expect(block?.textContent).toContain('%');
    expect(block?.textContent).toContain('3 tenus sur 4 refermés');
  });

  it('une tendance « down » se lit « à réancrer », JAMAIS en rouge punitif (§31.2)', () => {
    render(
      <CoachingInsightCard
        insight={insight({ progression: { ...insight().progression!, trend: 'down' } })}
      />,
    );
    expect(screen.getByText(/à réancrer/)).toBeInTheDocument();
    const card = document.querySelector('[data-slot="coaching-insight-card"]');
    expect(card?.textContent ?? '').not.toMatch(/échec|raté|nul\b|mauvais|honte|en chute/i);
  });

  it('sans progression, le bloc chiffré n’apparaît pas (jamais un chiffre inventé)', () => {
    render(<CoachingInsightCard insight={insight({ progression: null })} />);
    expect(document.querySelector('[data-slot="coaching-progression"]')).toBeNull();
  });

  it('affiche la traçabilité (E2/B) sous forme de puces « D’après »', () => {
    render(<CoachingInsightCard insight={insight()} />);
    expect(screen.getByText('D’après')).toBeInTheDocument();
    expect(screen.getByText('Alerte « bilans oubliés »')).toBeInTheDocument();
    expect(screen.getByText('Constance 72/100')).toBeInTheDocument();
  });

  it('GARDE-FOU §2 — aucun terme de marché à l’écran', () => {
    render(<CoachingInsightCard insight={insight()} />);
    const text = document.querySelector('[data-slot="coaching-insight-card"]')?.textContent ?? '';
    expect(text).not.toMatch(
      /\b(setup|achat|vente|buy|sell|long|short|pip|lots?|support|résistance|tendance|bougie|chandelier|take[- ]?profit|stop[- ]?loss)\b/i,
    );
  });
});
