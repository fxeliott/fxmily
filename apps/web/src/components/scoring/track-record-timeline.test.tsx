// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackRecordTimeline } from './track-record-timeline';
import type { TrackRecordTimelineItem } from '@/lib/trades/track-record-timeline';

afterEach(cleanup);

const ITEM = (over: Partial<TrackRecordTimelineItem> = {}): TrackRecordTimelineItem => ({
  id: 't1',
  date: new Date('2026-06-10T12:00:00.000Z'),
  pair: 'EURUSD',
  direction: 'long',
  realizedR: 1.5,
  realizedREstimated: false,
  planRespected: true,
  hasPhoto: true,
  hasDiscrepancy: false,
  ...over,
});

describe('TrackRecordTimeline — frise track record (S4 §33 #1)', () => {
  it('liste vide : invite calme, pas de frise', () => {
    render(<TrackRecordTimeline items={[]} />);
    expect(screen.getByText(/Ta frise apparaît dès ton premier trade clôturé/)).toBeInTheDocument();
  });

  it('chaque nœud relie au détail du trade (lien /journal/[id]) avec un label accessible', () => {
    render(<TrackRecordTimeline items={[ITEM({ id: 'abc123' })]} />);
    const link = screen.getByRole('link', { name: /Trade EURUSD long clôturé/ });
    expect(link).toHaveAttribute('href', '/journal/abc123');
    // The R réalisé and direction render inside the node.
    expect(screen.getByText('+1.5R')).toBeInTheDocument();
  });

  it('label accessible : énonce R, plan, écart et photo', () => {
    render(
      <TrackRecordTimeline
        items={[ITEM({ planRespected: false, hasDiscrepancy: true, hasPhoto: true })]}
      />,
    );
    const link = screen.getByRole('link');
    const label = link.getAttribute('aria-label') ?? '';
    expect(label).toContain('plan non tenu');
    expect(label).toContain('écart de vérité associé');
    expect(label).toContain('photo');
  });

  it('R estimé marqué « est. » ; R non chiffré rendu « — »', () => {
    render(<TrackRecordTimeline items={[ITEM({ realizedR: -1, realizedREstimated: true })]} />);
    expect(screen.getByText('est.')).toBeInTheDocument();
    expect(screen.getByText(/-1\.0R/)).toBeInTheDocument();
    cleanup();
    render(<TrackRecordTimeline items={[ITEM({ realizedR: null })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // §33.2 : l'écart est un repère CALME (cyan), jamais rouge punitif.
  it('le repère d’écart est cyan, jamais rouge', () => {
    const { container } = render(<TrackRecordTimeline items={[ITEM({ hasDiscrepancy: true })]} />);
    // The écart marker (ScanSearch) carries the cyan token, not --bad.
    expect(container.innerHTML).toContain('var(--cy)');
    // No bad-red on the écart row: the only --bad usage would be a loss R, and
    // this item is a +1.5R win → zero --bad anywhere.
    expect(container.innerHTML).not.toContain('var(--bad)');
  });
});
