// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MicroObjectiveView } from '@/lib/coaching/micro-objective';

import { EvolutionTraceCard } from './evolution-trace-card';

afterEach(cleanup);

const TZ = 'Europe/Paris';
const fmt = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ }).format(d);

function view(over: Partial<MicroObjectiveView> = {}): MicroObjectiveView {
  return {
    id: 'o1',
    axis: 'discipline',
    title: 'Tenir ta routine, un jour à la fois',
    intention: 'Ce soir, remplis ton bilan.',
    status: 'kept',
    sourceKind: 'alert',
    sourceRef: 'a1',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    closedAt: new Date('2026-06-03T10:00:00Z'),
    ...over,
  };
}

describe('EvolutionTraceCard — E2 trace horodatée (S5 §32)', () => {
  it('renders nothing with no history (never a simulated past)', () => {
    const { container } = render(<EvolutionTraceCard items={[]} timezone={TZ} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the created→closed loop with both dates in the member timezone', () => {
    render(<EvolutionTraceCard items={[view()]} timezone={TZ} />);
    const card = document.querySelector('[data-slot="evolution-trace-card"]');
    expect(card).not.toBeNull();
    expect(screen.getByText('Tenu')).toBeInTheDocument();
    const text = card?.textContent ?? '';
    expect(text).toContain(`Ouvert le ${fmt(new Date('2026-06-01T10:00:00Z'))}`);
    expect(text).toContain(`refermé le ${fmt(new Date('2026-06-03T10:00:00Z'))}`);
  });

  it('an open loop (no closedAt) shows only the open date — no "refermé"', () => {
    render(
      <EvolutionTraceCard
        items={[view({ id: 'op', status: 'open', closedAt: null })]}
        timezone={TZ}
      />,
    );
    expect(screen.getByText('En cours')).toBeInTheDocument();
    const row = document.querySelector('[data-status="open"]');
    expect(row?.textContent ?? '').not.toMatch(/refermé/);
  });

  it('§31.2 — a missed loop reads "Pas tenu", never a punitive verdict', () => {
    render(<EvolutionTraceCard items={[view({ id: 'm', status: 'missed' })]} timezone={TZ} />);
    expect(screen.getByText('Pas tenu')).toBeInTheDocument();
    const text = document.querySelector('[data-slot="evolution-trace-card"]')?.textContent ?? '';
    expect(text).not.toMatch(/échec|raté|nul\b|mauvais|honte/i);
  });
});
