// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DiscrepancyView,
  VerificationAccountView,
  VerificationOverview,
} from '@/lib/verification/service';

// The panel renders the `ResolveDiscrepancyButton` client island (Tour 11) which
// references the server action. Mock it so this presentational test never pulls
// NextAuth/next-cache (same pattern as `micro-objective-card.test.tsx`).
vi.mock('@/app/admin/members/[id]/resolve-discrepancy-actions', () => ({
  resolveDiscrepancyAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import { MemberVerificationPanel } from './member-verification-panel';

afterEach(cleanup);

const EMPTY_OVERVIEW: VerificationOverview = {
  accounts: [],
  proofs: [],
  pendingProofsCount: 0,
};

function account(over: Partial<VerificationAccountView> = {}): VerificationAccountView {
  return {
    id: 'acc-1',
    label: 'Compte perso',
    type: 'personal',
    brokerName: 'IC Markets',
    detectedByAI: false,
    confidence: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    proofsCount: 1,
    positionsCount: 3,
    ...over,
  };
}

function overviewWith(accounts: VerificationAccountView[]): VerificationOverview {
  return { accounts, proofs: [], pendingProofsCount: 0 };
}

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
    offDayNeutralized: false,
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
        memberId="member-1"
        overview={EMPTY_OVERVIEW}
        constancy={null}
        discrepancies={[discrepancy()]}
        alerts={[]}
        history={[]}
      />,
    );
    // Admin voice (CAND-A) — the panel reads a MEMBER's data, so the face-à-face
    // is third-person ("le membre / son historique"), never "tu / ton".
    expect(screen.getByText('Ce que le membre a déclaré')).toBeInTheDocument();
    expect(screen.getByText('Ce que son historique montre')).toBeInTheDocument();
    expect(screen.queryByText('Ce que tu as déclaré')).toBeNull();
    // The concrete matched metadata is surfaced (instrument on BOTH sides), not
    // just the narrative reasoning — that is the whole point of the face-à-face.
    expect(screen.getAllByText('EURUSD').length).toBeGreaterThanOrEqual(2);
  });

  it('ne rend AUCUN face-à-face pour un rituel sans côté trade (les deux nuls)', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
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
    expect(screen.queryByText('Ce que le membre a déclaré')).toBeNull();
    expect(screen.queryByText('Ce que son historique montre')).toBeNull();
  });
});

/**
 * Tour 13 — the admin « réalité vs déclaré » tally + per-account vision badge.
 * Factual, neutral, never an accusation (posture §31.2).
 */
describe('MemberVerificationPanel — réalité vs déclaré (Tour 13)', () => {
  it('shows the declared vs detected tally once the vision has run', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
        overview={overviewWith([
          account({ id: 'a1', detectedByAI: false }),
          account({ id: 'a2', detectedByAI: true, confidence: 0.92 }),
        ])}
        constancy={null}
        discrepancies={[]}
        alerts={[]}
        history={[]}
      />,
    );
    expect(screen.getByText('Réalité vs déclaré')).toBeInTheDocument();
    expect(screen.getByText('Comptes déclarés')).toBeInTheDocument();
    expect(screen.getByText('Détectés par la vision')).toBeInTheDocument();
    // 1 declared + 1 detected → aligned, calm mute pill, no « écart ».
    expect(screen.getByText('Comptes alignés')).toBeInTheDocument();
    expect(screen.queryByText('Écart à explorer en séance')).toBeNull();
  });

  it('flags a NEUTRAL « écart à explorer » when detected ≠ declared (never « incohérence »)', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
        overview={overviewWith([
          account({ id: 'a1', detectedByAI: false }),
          account({ id: 'a2', detectedByAI: true, confidence: 0.8 }),
          account({ id: 'a3', detectedByAI: true, confidence: 0.7 }),
        ])}
        constancy={null}
        discrepancies={[]}
        alerts={[]}
        history={[]}
      />,
    );
    // 1 declared vs 2 detected → divergence, neutral wording only.
    expect(screen.getByText('Écart à explorer en séance')).toBeInTheDocument();
    expect(screen.queryByText(/incohérence/i)).toBeNull();
    expect(screen.queryByText(/mensonge/i)).toBeNull();
  });

  it('does NOT render the tally when the vision has not run (no detected account)', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
        overview={overviewWith([account({ id: 'a1', detectedByAI: false })])}
        constancy={null}
        discrepancies={[]}
        alerts={[]}
        history={[]}
      />,
    );
    // The tally card self-guards: a lone declared account with no vision pass
    // would otherwise show a misleading « 0 détectés ».
    expect(screen.queryByText('Réalité vs déclaré')).toBeNull();
  });

  it('surfaces the vision confidence next to a detected account', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
        overview={overviewWith([account({ id: 'a2', detectedByAI: true, confidence: 0.92 })])}
        constancy={null}
        discrepancies={[]}
        alerts={[]}
        history={[]}
      />,
    );
    expect(screen.getByText('Détecté (confiance 92 %)')).toBeInTheDocument();
  });

  it('omits the percent when a detected account has no recorded confidence', () => {
    render(
      <MemberVerificationPanel
        memberId="member-1"
        overview={overviewWith([account({ id: 'a2', detectedByAI: true, confidence: null })])}
        constancy={null}
        discrepancies={[]}
        alerts={[]}
        history={[]}
      />,
    );
    expect(screen.getByText('Détecté par la vision')).toBeInTheDocument();
    expect(screen.queryByText(/confiance/)).toBeNull();
  });
});
