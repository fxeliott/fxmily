// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerializedTrainingAnnotation } from '@/lib/admin/training-annotation-service';

// The delete CTA + the member reply form statically import a page Server Action
// → next-auth → next/server, unresolvable in jsdom. They are leaf client islands,
// not the subject here (the read-receipt pills), so stub them to a no-op.
vi.mock('./delete-training-annotation-button', () => ({
  DeleteTrainingAnnotationButton: () => null,
}));
vi.mock('./training-reply-form', () => ({
  TrainingReplyForm: () => null,
}));

// Storage: resolve a legacy mediaKey to a deterministic URL so the LEGACY image
// branch renders (the real dev storage would throw on the fake key). Any other
// call path (mediaKey null) never reaches getReadUrl.
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    selectStorage: () => ({ getReadUrl: (key: string) => `https://cdn.test/${key}` }),
  };
});

import { TrainingAnnotationsSection } from './training-annotations-section';

afterEach(cleanup);

const TV_URL = 'https://fr.tradingview.com/x/abcdefghijkl/';

function annotation(
  over: Partial<SerializedTrainingAnnotation> = {},
): SerializedTrainingAnnotation {
  return {
    id: 'ta1',
    trainingTradeId: 'tt1',
    adminId: 'admin1',
    comment: 'Entrée 2 bougies trop tôt — attends la confirmation.',
    tradingViewUrl: null,
    mediaKey: null,
    mediaType: null,
    axis: null,
    seenByMemberAt: null,
    createdAt: '2026-06-10T09:00:00.000Z',
    updatedAt: '2026-06-10T09:00:00.000Z',
    isUnseenByMember: true,
    memberReply: null,
    memberRepliedAt: null,
    ...over,
  };
}

/**
 * S7 §33-#3 re-challenge (DEFECT-1): the TRAINING corrections list is a "carbon
 * mirror" of the real-trade one and must carry BOTH read-receipt pills for the
 * admin — « Non lue » (amber, waiting) AND « Lue » (green, the member opened the
 * backtest correction). Before the fix only « Non lue » existed, so a read
 * backtest correction gave the admin no positive confirmation — an asymmetry vs
 * the real-trade surface. Deterministic proof of the « Lue » pill flip (the e2e
 * proves the same flip end-to-end, but this guards the render contract directly).
 */
describe('TrainingAnnotationsSection — accusé de lecture (S7 §33-#3 parité)', () => {
  it('admin : « Non lue » tant que le membre n’a pas ouvert (seenByMemberAt null)', () => {
    render(
      <TrainingAnnotationsSection annotations={[annotation()]} isAdmin currentUserId="admin1" />,
    );
    expect(screen.getByText('Non lue')).toBeInTheDocument();
    expect(screen.queryByText(/par le membre le/)).toBeNull();
  });

  it('admin : « Lue » (+ date sr-only) une fois le backtest ouvert par le membre', () => {
    render(
      <TrainingAnnotationsSection
        annotations={[
          annotation({ seenByMemberAt: '2026-06-11T08:30:00.000Z', isUnseenByMember: false }),
        ]}
        isAdmin
        currentUserId="admin1"
      />,
    );
    // « Lue » alone is a substring of « Non lue », so anchor on the sr-only date
    // string that renders ONLY inside the green « Lue » pill branch.
    expect(screen.getByText(/par le membre le/)).toBeInTheDocument();
    expect(screen.queryByText('Non lue')).toBeNull();
  });

  it('membre (isAdmin=false) : aucun badge d’accusé de lecture (surface admin only)', () => {
    render(
      <TrainingAnnotationsSection
        annotations={[
          annotation({ seenByMemberAt: '2026-06-11T08:30:00.000Z', isUnseenByMember: false }),
        ]}
        isAdmin={false}
      />,
    );
    expect(screen.queryByText('Non lue')).toBeNull();
    expect(screen.queryByText(/par le membre le/)).toBeNull();
  });
});

/**
 * Tour 13 — corrections now carry an optional TradingView link in place of the
 * former upload; legacy uploaded captures stay readable but degrade gracefully
 * when the file is purged in prod (onError island → "Capture retirée.").
 */
describe('TrainingAnnotationsSection — Tour 13 lien TradingView + capture legacy', () => {
  it('affiche un lien cliquable « Voir la correction sur TradingView » quand tradingViewUrl est présent', () => {
    render(
      <TrainingAnnotationsSection
        annotations={[annotation({ tradingViewUrl: TV_URL })]}
        isAdmin={false}
      />,
    );
    const link = screen.getByRole('link', { name: 'Voir la correction sur TradingView' });
    expect(link).toHaveAttribute('href', TV_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('aucun lien TradingView quand tradingViewUrl est null', () => {
    render(<TrainingAnnotationsSection annotations={[annotation()]} isAdmin={false} />);
    expect(screen.queryByRole('link', { name: /TradingView/ })).toBeNull();
  });

  it('rend l’image legacy (mediaKey non null) puis la dégrade en « Capture retirée. » sur erreur de chargement', () => {
    render(
      <TrainingAnnotationsSection
        annotations={[
          annotation({ mediaKey: 'training_annotations/tt1/x.png', mediaType: 'image' }),
        ]}
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
