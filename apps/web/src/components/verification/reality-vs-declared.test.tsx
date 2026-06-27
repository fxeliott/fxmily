// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RealityVsDeclared } from './reality-vs-declared';

afterEach(cleanup);

const DECLARED = {
  pair: 'EURUSD',
  direction: 'long' as const,
  lotSize: 0.5,
  enteredAt: new Date('2026-06-20T09:30:00.000Z'),
};
const REALITY = {
  symbol: 'GBPUSD',
  side: 'short' as const,
  volume: 1.25,
  openTime: new Date('2026-06-20T11:00:00.000Z'),
  pnl: 50,
};

describe('RealityVsDeclared — face-à-face « Réalité vs Déclaré » (DoD §33)', () => {
  it('mismatch : les DEUX côtés posés ligne par ligne', () => {
    render(<RealityVsDeclared declared={DECLARED} reality={REALITY} type="mismatch" />);
    expect(screen.getByText('Ce que tu as déclaré')).toBeInTheDocument();
    expect(screen.getByText('Ce que ton historique montre')).toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.getByText('GBPUSD')).toBeInTheDocument();
    // P&L only shown on the reality side, signed.
    expect(screen.getByText('+50')).toBeInTheDocument();
  });

  it('position réelle non déclarée (missing_declared) : côté déclaré vide + côté réel rempli', () => {
    render(<RealityVsDeclared declared={null} reality={REALITY} type="missing_declared" />);
    expect(screen.getByText('Rien de déclaré pour cette position')).toBeInTheDocument();
    expect(screen.getByText('GBPUSD')).toBeInTheDocument();
    expect(screen.queryByText('EURUSD')).not.toBeInTheDocument();
  });

  it('trade déclaré sans contrepartie (false_declared) : côté réel vide + côté déclaré rempli', () => {
    render(<RealityVsDeclared declared={DECLARED} reality={null} type="false_declared" />);
    expect(screen.getByText("Aucune trace dans l'historique fourni")).toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('GBPUSD')).not.toBeInTheDocument();
  });

  it('aucun côté (oubli de rituel) : ne rend rien', () => {
    const { container } = render(
      <RealityVsDeclared declared={null} reality={null} type="unfilled_no_reason" />,
    );
    expect(container.firstChild).toBeNull();
  });

  // FIND-1 (re-challenge #2) — both FK sides are `onDelete: SetNull`, so a
  // `mismatch` (both sides existed at detection) can lose a side AFTER the fact
  // (member deletes the journal trade / proof position purged). The empty-side
  // note MUST NOT then claim "rien de déclaré" / "aucune trace" — that would lie
  // about a row that DID exist. The note is type-aware: only the intrinsically
  // one-sided types keep the "never existed" wording.
  it('mismatch avec côté déclaré effacé après coup : note « retiré du journal », pas « rien de déclaré »', () => {
    render(<RealityVsDeclared declared={null} reality={REALITY} type="mismatch" />);
    expect(screen.getByText('Trade déclaré, retiré du journal depuis')).toBeInTheDocument();
    expect(screen.queryByText('Rien de déclaré pour cette position')).toBeNull();
  });

  it('mismatch avec côté réel effacé après coup : note « retirée de l’historique », pas « aucune trace »', () => {
    render(<RealityVsDeclared declared={DECLARED} reality={null} type="mismatch" />);
    expect(screen.getByText("Position retirée de l'historique depuis")).toBeInTheDocument();
    expect(screen.queryByText("Aucune trace dans l'historique fourni")).toBeNull();
  });

  // CAND-A (re-challenge #2) — admin voice: on /admin/members/[id] the panel
  // reads a MEMBER's data, so "tu / ton" (second person) mislabels it as the
  // admin's own. `voice="admin"` switches to "le membre / son historique".
  it('voice="admin" : en-têtes à la 3e personne (le membre / son historique)', () => {
    render(
      <RealityVsDeclared declared={DECLARED} reality={REALITY} type="mismatch" voice="admin" />,
    );
    expect(screen.getByText('Ce que le membre a déclaré')).toBeInTheDocument();
    expect(screen.getByText('Ce que son historique montre')).toBeInTheDocument();
    expect(screen.queryByText('Ce que tu as déclaré')).toBeNull();
    expect(screen.queryByText('Ce que ton historique montre')).toBeNull();
  });
});
