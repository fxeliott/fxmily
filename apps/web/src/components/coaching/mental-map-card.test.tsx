// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MentalMapEntry } from '@/lib/coaching/mental-map';

import { MentalMapCard } from './mental-map-card';

afterEach(cleanup);

function entry(over: Partial<MentalMapEntry> = {}): MentalMapEntry {
  return {
    id: 'alert:a1',
    observation: 'Plusieurs journées sans suivi, sans motif (×3).',
    meaning: 'Ne pas regarder son propre travail, c’est souvent éviter une vérité inconfortable.',
    action: 'Ce soir, remplis ton bilan — même en une seule ligne.',
    axis: 'discipline',
    tone: 'alert',
    source: { kind: 'alert', alertId: 'a1', triggerType: 'forgot_no_reason_repeat' },
    ...over,
  };
}

describe('MentalMapCard — E1 carte mentale (S5 §32, posture §2)', () => {
  it('renders nothing on an empty map (no fabricated entry)', () => {
    const { container } = render(<MentalMapCard entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the triptych observé → signification → geste for an entry', () => {
    render(<MentalMapCard entries={[entry()]} />);
    expect(document.querySelector('[data-slot="mental-map-card"]')).not.toBeNull();
    expect(screen.getByText(/Plusieurs journées sans suivi/)).toBeInTheDocument();
    expect(screen.getByText('Ce que ça signifie')).toBeInTheDocument();
    expect(screen.getByText('Ton geste')).toBeInTheDocument();
    expect(screen.getByText(/remplis ton bilan/)).toBeInTheDocument();
  });

  it('compact shows ONLY the highest-priority entry (never a wall, §33.2)', () => {
    render(
      <MentalMapCard
        variant="compact"
        entries={[
          entry({ id: 'alert:a1', observation: 'OBS-PRIORITAIRE' }),
          entry({
            id: 'signal:x',
            observation: 'OBS-SECONDAIRE',
            tone: 'watch',
            source: { kind: 'signal', reason: 'forgot_no_reason' },
          }),
        ]}
      />,
    );
    expect(screen.getByText('OBS-PRIORITAIRE')).toBeInTheDocument();
    expect(screen.queryByText('OBS-SECONDAIRE')).toBeNull();
    expect(document.querySelectorAll('[data-slot="mental-map-entry"]')).toHaveLength(1);
  });

  it('tone drives a calm verdict chip, never a punitive one (§31.2)', () => {
    render(<MentalMapCard entries={[entry({ tone: 'alert' })]} />);
    expect(screen.getByText('À renforcer')).toBeInTheDocument();
    const card = document.querySelector('[data-slot="mental-map-card"]');
    expect(card?.textContent ?? '').not.toMatch(/échec|nul|raté|honte|mauvais/i);
  });

  it('GARDE-FOU §2 — never surfaces a market/analysis term', () => {
    render(
      <MentalMapCard
        entries={[
          entry(),
          entry({
            id: 'signal:rg',
            tone: 'watch',
            axis: 'ego',
            observation: 'Un écart ponctuel entre ton déclaré et le réel.',
            meaning:
              'Pas de drame : juste l’occasion de réaligner ce que tu dis avec ce que tu fais.',
            action: 'Compare ta dernière déclaration à ton historique réel.',
            source: { kind: 'signal', reason: 'reality_gap' },
          }),
        ]}
      />,
    );
    const text = document.querySelector('[data-slot="mental-map-card"]')?.textContent ?? '';
    expect(text).not.toMatch(
      /\b(setup|achat|vente|buy|sell|long|short|pip|lots?|support|résistance|tendance|bougie|chandelier|take[- ]?profit|stop[- ]?loss)\b/i,
    );
  });
});
