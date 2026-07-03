// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MorningBridge } from '@/lib/coaching/morning-bridge';

import { MorningBridgeCard } from './morning-bridge-card';
import { StageAwareLine } from './stage-aware-line';

afterEach(cleanup);

/**
 * Tour 11 — render proof of the calm morning surfaces. Both are presentational
 * server components; we prove they render the copy, convey state in TEXT (never
 * colour-only), and tag data-slots for the e2e/runtime audit.
 */

const YESTERDAY: MorningBridge = {
  title: 'Ton pont avec hier',
  kind: 'yesterday',
  tone: 'ok',
  lines: ['Hier tu as tenu ton intention. On repart de là.'],
};

const WELCOME: MorningBridge = {
  title: 'Content de te revoir',
  kind: 'welcome-back',
  tone: 'ok',
  lines: ['Content de te revoir. On reprend calmement, un jour à la fois.'],
};

describe('MorningBridgeCard', () => {
  it('renders the yesterday-echo title and lines', () => {
    const { container } = render(<MorningBridgeCard bridge={YESTERDAY} />);
    expect(screen.getByText('Ton pont avec hier')).toBeInTheDocument();
    expect(screen.getByText(/tenu ton intention/)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="morning-bridge"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="yesterday"]')).not.toBeNull();
  });

  it('renders the welcome-back variant with its own kind tag', () => {
    const { container } = render(<MorningBridgeCard bridge={WELCOME} />);
    // The phrase appears in both the title and the line — assert the line copy.
    expect(screen.getByText(/On reprend calmement/)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="welcome-back"]')).not.toBeNull();
  });

  it('marks the decorative glyph aria-hidden (state is in text)', () => {
    const { container } = render(<MorningBridgeCard bridge={YESTERDAY} />);
    expect(container.querySelector('svg[aria-hidden]')).not.toBeNull();
  });
});

describe('StageAwareLine', () => {
  it('renders nothing without a stage (never fabricates)', () => {
    const { container } = render(<StageAwareLine stage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('names the stage in text and tags data-stage', () => {
    const { container } = render(<StageAwareLine stage="mechanical" />);
    expect(screen.getByText(/Stade mécanique/)).toBeInTheDocument();
    expect(container.querySelector('[data-stage="mechanical"]')).not.toBeNull();
  });

  it('renders each of the three stages with distinct copy', () => {
    const { rerender, container } = render(<StageAwareLine stage="subjective" />);
    expect(screen.getByText(/Stade subjectif/)).toBeInTheDocument();
    rerender(<StageAwareLine stage="intuitive" />);
    expect(screen.getByText(/Stade intuitif/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('—');
  });
});
