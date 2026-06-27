// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DiscrepancyView, VerificationOverview } from '@/lib/verification/service';

import { MemberVerificationPanel } from './member-verification-panel';

afterEach(cleanup);

const EMPTY_OVERVIEW: VerificationOverview = {
  accounts: [],
  proofs: [],
  pendingProofsCount: 0,
};

function discrepancy(over: Partial<DiscrepancyView> = {}): DiscrepancyView {
  return {
    id: 'd1',
    type: 'mismatch',
    severity: 2,
    status: 'open',
    reasoning: 'La taille déclarée ne correspond pas à la position lue.',
    memberReason: null,
    detectedAt: new Date('2026-06-10T12:00:00.000Z'),
    declared: {
      pair: 'EURUSD',
      direction: 'long',
      lotSize: 1,
      enteredAt: new Date('2026-06-10T09:00:00.000Z'),
    },
    reality: {
      symbol: 'EURUSD',
      side: 'long',
      volume: 2,
      openTime: new Date('2026-06-10T09:05:00.000Z'),
      pnl: 120,
    },
    ...over,
  };
}

/**
 * S7 §29-#2 re-challenge (DEFECT-3): the admin verification panel must SURFACE
 * the « réalité prouvée vs déclaratif » face-à-face that the data layer matched
 * — not just the generic reasoning. The face-à-face component is the same one
 * the member sees (`RealityVsDeclared`), reused here so the admin « voit tout ».
 */
describe('MemberVerificationPanel — face-à-face réalité vs déclaré (S7 §29-#2)', () => {
  it('rend le face-à-face declared/reality quand l’écart porte les deux côtés', () => {
    render(
      <MemberVerificationPanel
        overview={EMPTY_OVERVIEW}
        constancy={null}
        discrepancies={[discrepancy()]}
        alerts={[]}
        history={[]}
      />,
    );
    expect(screen.getByText('Ce que tu as déclaré')).toBeInTheDocument();
    expect(screen.getByText('Ce que ton historique montre')).toBeInTheDocument();
    // The concrete matched metadata is surfaced (instrument on BOTH sides), not
    // just the narrative reasoning — that is the whole point of the face-à-face.
    expect(screen.getAllByText('EURUSD').length).toBeGreaterThanOrEqual(2);
  });

  it('ne rend AUCUN face-à-face pour un rituel sans côté trade (les deux nuls)', () => {
    render(
      <MemberVerificationPanel
        overview={EMPTY_OVERVIEW}
        constancy={null}
        discrepancies={[
          discrepancy({
            id: 'd2',
            type: 'unfilled_no_reason',
            declared: null,
            reality: null,
            reasoning: 'Journée sans suivi.',
          }),
        ]}
        alerts={[]}
        history={[]}
      />,
    );
    // The discrepancy card still renders (its type label), but the face-à-face
    // self-guards to null — no empty « Déclaré / Réel » columns for a ritual.
    expect(screen.getByText('Journée sans suivi')).toBeInTheDocument();
    expect(screen.queryByText('Ce que tu as déclaré')).toBeNull();
    expect(screen.queryByText('Ce que ton historique montre')).toBeNull();
  });
});
