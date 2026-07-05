// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerializedAnnotation } from '@/lib/admin/annotations-service';

// The delete CTA statically imports a page Server Action → next-auth →
// next/server, unresolvable in jsdom. It is a leaf client island, not the
// subject here (the Tour 13 link + legacy degradation), so stub it to a no-op.
vi.mock('./delete-annotation-button', () => ({
  DeleteAnnotationButton: () => null,
}));

// Storage: resolve a legacy mediaKey to a deterministic URL so the LEGACY image
// branch renders (the real dev storage would throw on the fake key).
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    selectStorage: () => ({ getReadUrl: (key: string) => `https://cdn.test/${key}` }),
  };
});

import { AnnotationsSection } from './annotations-section';

afterEach(cleanup);

const TV_URL = 'https://fr.tradingview.com/x/abcdefghijkl/';

function annotation(over: Partial<SerializedAnnotation> = {}): SerializedAnnotation {
  return {
    id: 'an1',
    tradeId: 't1',
    adminId: 'admin1',
    comment: 'Sizing doublé après 2 wins — attention.',
    tradingViewUrl: null,
    mediaKey: null,
    mediaType: null,
    axis: null,
    seenByMemberAt: null,
    createdAt: '2026-06-10T09:00:00.000Z',
    updatedAt: '2026-06-10T09:00:00.000Z',
    isUnseenByMember: true,
    ...over,
  };
}

/**
 * Tour 13 — corrections carry an optional TradingView link in place of the
 * former upload; legacy uploaded captures stay readable but degrade gracefully
 * when the file is purged in prod (onError island → "Capture retirée.").
 */
describe('AnnotationsSection — Tour 13 lien TradingView + capture legacy', () => {
  it('affiche un lien cliquable « Voir la correction sur TradingView » quand tradingViewUrl est présent', () => {
    render(
      <AnnotationsSection annotations={[annotation({ tradingViewUrl: TV_URL })]} isAdmin={false} />,
    );
    const link = screen.getByRole('link', { name: 'Voir la correction sur TradingView' });
    expect(link).toHaveAttribute('href', TV_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('aucun lien TradingView quand tradingViewUrl est null', () => {
    render(<AnnotationsSection annotations={[annotation()]} isAdmin={false} />);
    expect(screen.queryByRole('link', { name: /TradingView/ })).toBeNull();
  });

  it('rend l’image legacy (mediaKey non null) puis la dégrade en « Capture retirée. » sur erreur de chargement', () => {
    render(
      <AnnotationsSection
        annotations={[annotation({ mediaKey: 'annotations/t1/x.png', mediaType: 'image' })]}
        isAdmin={false}
      />,
    );
    const img = screen.getByAltText(/Capture annotée jointe/);
    expect(img).toBeInTheDocument();
    expect(screen.queryByText('Capture retirée.')).toBeNull();
    // Simulate the purged-file case: the browser fires <img onError>.
    fireEvent.error(img);
    expect(screen.getByText('Capture retirée.')).toBeInTheDocument();
    expect(screen.queryByAltText(/Capture annotée jointe/)).toBeNull();
  });
});
