// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SerializedTrade } from '@/lib/trades/service';

import { TradeCard } from './trade-card';

afterEach(cleanup);

/**
 * F2 (representative G4 display test) — `TradeCard` renders the absolute
 * `enteredAt` instant in the MEMBER's set timezone. The same UTC instant must
 * read as a different wall-clock per zone, and the default (no prop) stays on
 * Europe/Paris so admin callers are unaffected. This proves the prop → Intl
 * formatter wiring at runtime for the canonical G4 component; the offset math
 * itself is unit-tested in `lib/timezones.test.ts`.
 */

// 12:30 UTC = 14:30 in Paris (CEST) = 08:30 in New York (EDT).
const ENTERED_AT = '2026-05-06T12:30:00.000Z';

function openTrade(): SerializedTrade {
  return {
    id: 'trd_1',
    userId: 'usr_1',
    pair: 'EURUSD',
    direction: 'long',
    session: 'overlap',
    enteredAt: ENTERED_AT,
    entryPrice: '1.08500',
    lotSize: '0.50',
    stopLossPrice: '1.08000',
    plannedRR: '2',
    tradeQuality: null,
    riskPct: null,
    emotionBefore: [],
    planRespected: true,
    hedgeRespected: null,
    processComplete: null,
    slPerRule: null,
    movedToBe: null,
    partialAtTarget: null,
    notes: null,
    screenshotEntryKey: null,
    tradingViewEntryUrl: 'https://www.tradingview.com/x/abc123/',
    exitedAt: null,
    exitPrice: null,
    outcome: null,
    exitReason: null,
    realizedR: null,
    realizedRSource: null,
    emotionDuring: [],
    emotionAfter: [],
    screenshotExitKey: null,
    tradingViewExitUrl: null,
    closedAt: null,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    isClosed: false,
  };
}

describe('TradeCard — entry instant in the member timezone (F2)', () => {
  it('renders the entry wall-clock in the passed member timezone', () => {
    const { container } = render(<TradeCard trade={openTrade()} timezone="Europe/Paris" />);
    expect(container.textContent).toContain('14:30');
    expect(container.textContent).not.toContain('08:30');
  });

  it('renders the SAME instant differently for a member in another timezone', () => {
    const { container } = render(<TradeCard trade={openTrade()} timezone="America/New_York" />);
    expect(container.textContent).toContain('08:30');
    expect(container.textContent).not.toContain('14:30');
  });

  it('defaults to Europe/Paris when no timezone is passed (admin callers unaffected)', () => {
    const { container } = render(<TradeCard trade={openTrade()} />);
    expect(container.textContent).toContain('14:30');
  });

  it('localizes the instant inside the accessible aria-label too (not just the visible row)', () => {
    const { container } = render(<TradeCard trade={openTrade()} timezone="America/New_York" />);
    const link = container.querySelector('a[aria-label]');
    expect(link?.getAttribute('aria-label')).toContain('08:30');
  });
});

/**
 * Tour 10 — open verification discrepancy badge. Same contract as the unseen
 * annotations pill: hidden at 0 (default), singular/plural label, and the
 * count surfaces in the accessible name so screen readers hear it too.
 */
describe('TradeCard — open discrepancy badge (tour 10)', () => {
  it('renders nothing when the count is 0 or the prop is omitted', () => {
    const { container } = render(<TradeCard trade={openTrade()} />);
    expect(container.textContent).not.toContain('à regarder');
  });

  it('renders the singular badge and enriches the aria-label', () => {
    const { container } = render(<TradeCard trade={openTrade()} openDiscrepancyCount={1} />);
    expect(container.textContent).toContain('Écart à regarder');
    const link = container.querySelector('a[aria-label]');
    expect(link?.getAttribute('aria-label')).toContain('1 écart de vérification à regarder');
  });

  it('renders the plural badge with the count', () => {
    const { container } = render(<TradeCard trade={openTrade()} openDiscrepancyCount={3} />);
    expect(container.textContent).toContain('3 écarts à regarder');
  });
});
