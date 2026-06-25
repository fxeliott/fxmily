// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessObjective } from '@/lib/objectives/service';
import type { ConstancyScoreView } from '@/lib/verification/constancy';

import { ConstancyObjectiveBridge } from './constancy-objective-bridge';

afterEach(cleanup);

// The component only reads `score.value` and `focus.label` — minimal fixtures.
const score = { value: 72 } as ConstancyScoreView;
const focus = { label: 'Discipline' } as ProcessObjective;

describe('ConstancyObjectiveBridge — pont score → objectif (S4 CONTEXTE GLOBAL)', () => {
  it('rend null sans score (honnêteté §33.5, jamais un 100 fabriqué)', () => {
    const { container } = render(
      <ConstancyObjectiveBridge score={null} focus={focus} coachingAxis="gérer mes émotions" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('rend null sans objectif (ni levier dérivé ni axe stated)', () => {
    const { container } = render(
      <ConstancyObjectiveBridge score={score} focus={null} coachingAxis={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('levier DÉRIVÉ (déterministe) : pas de badge IA, lien vers /objectifs', () => {
    render(<ConstancyObjectiveBridge score={score} focus={focus} coachingAxis={null} />);
    const bridge = screen.getByRole('link');
    expect(bridge).toHaveAttribute('href', '/objectifs');
    expect(bridge).toHaveAttribute('data-slot', 'constancy-objective-bridge');
    expect(screen.getByText(/ton levier du moment : Discipline/)).toBeInTheDocument();
    // focus.label is deterministic → NO AI disclosure.
    expect(screen.queryByText(/Généré par IA/)).not.toBeInTheDocument();
  });

  it('axe STATED (coachingAxis, Claude-derived) : PORTE le AIGeneratedBanner (AI Act §50)', () => {
    render(
      <ConstancyObjectiveBridge score={score} focus={null} coachingAxis="gérer mes émotions" />,
    );
    expect(screen.getByText(/ce sur quoi tu travailles : gérer mes émotions/)).toBeInTheDocument();
    // coachingAxis is Claude-derived → the §50 disclosure is mandatory here.
    expect(screen.getByText(/Généré par IA/)).toBeInTheDocument();
  });

  it('JAMAIS de rouge punitif (§33.2) — un pont, pas un verdict', () => {
    const { container } = render(
      <ConstancyObjectiveBridge score={score} focus={null} coachingAxis="gérer mes émotions" />,
    );
    expect(container.querySelectorAll('[data-tone="bad"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('var(--bad)');
  });
});
