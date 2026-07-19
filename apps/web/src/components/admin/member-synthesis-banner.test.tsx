// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MemberSynthesisBanner } from './member-synthesis-banner';
import type { MemberAttention } from '@/lib/admin/attention-service';
import type { SerializedBehavioralScore } from '@/lib/scoring/service';

afterEach(cleanup);

/**
 * J6-admin-scale (scope 3) — render proof that the synthesis banner surfaces the
 * correct signals from representative mock data: the triage counts + their tab
 * deep-links, the décrochage flag, honest « non calculé » for a null score
 * dimension, and the anti Black-Hat posture (calm amber/accent, NEVER red).
 */

const ATTENTION = (over: Partial<MemberAttention> = {}): MemberAttention => ({
  tradesToComment: 0,
  openDiscrepancies: 0,
  constancyDeclining: false,
  ...over,
});

/** Minimal SerializedBehavioralScore — the banner reads only the 4 dim fields. */
function score(over: Partial<SerializedBehavioralScore> = {}): SerializedBehavioralScore {
  return {
    disciplineScore: 72,
    emotionalStabilityScore: 61,
    consistencyScore: 55,
    engagementScore: 88,
    ...over,
  } as unknown as SerializedBehavioralScore;
}

function hrefsOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

describe('MemberSynthesisBanner — landmark + heading', () => {
  it('exposes a labelled section landmark with a level-2 heading', () => {
    const { container } = render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION()}
        score={score()}
      />,
    );
    expect(
      container.querySelector('section[aria-labelledby="member-synthesis-heading"]'),
    ).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Synthèse' })).toBeInTheDocument();
  });
});

describe('MemberSynthesisBanner — status pill (pending signals)', () => {
  it('reads « À jour » when nothing pends', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION()}
        score={score()}
      />,
    );
    expect(screen.getByText('À jour')).toBeInTheDocument();
  });

  it('counts each active signal (décrochage + à commenter + constance = 3)', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={null}
        disengaged
        attention={ATTENTION({
          tradesToComment: 3,
          openDiscrepancies: 0,
          constancyDeclining: true,
        })}
        score={score()}
      />,
    );
    expect(screen.getByText(/3\s+à suivre/)).toBeInTheDocument();
  });
});

describe('MemberSynthesisBanner — triage signals + tab deep-links', () => {
  it('renders the attention counts and links each to the tab that resolves it', () => {
    const { container } = render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION({
          tradesToComment: 4,
          openDiscrepancies: 2,
          constancyDeclining: true,
        })}
        score={score()}
      />,
    );

    expect(screen.getByText('À commenter')).toBeInTheDocument();
    expect(screen.getByText('Écarts ouverts')).toBeInTheDocument();
    expect(screen.getByText('Constance')).toBeInTheDocument();
    // Constance flag surfaces its state verbatim.
    expect(screen.getByText('En baisse')).toBeInTheDocument();

    const hrefs = hrefsOf(container);
    expect(hrefs).toContain('/admin/members/m1?tab=trades');
    expect(hrefs).toContain('/admin/members/m1?tab=verification');
    // The score « Détail » link points at the overview tab (its canonical href).
    expect(hrefs).toContain('/admin/members/m1');
  });

  it('flags décrochage on the activity cell and shows « Jamais vu » for a never-seen member', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={null}
        disengaged
        attention={ATTENTION()}
        score={score()}
      />,
    );
    expect(screen.getByText('Jamais vu')).toBeInTheDocument();
    expect(screen.getByText('En décrochage')).toBeInTheDocument();
  });

  it('reads « Stable » on the constance cell when the score is not declining', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION({ constancyDeclining: false })}
        score={score()}
      />,
    );
    expect(screen.getByText('Stable')).toBeInTheDocument();
  });
});

describe('MemberSynthesisBanner — behavioral score', () => {
  it('renders the four dimension labels with their values', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION()}
        score={score({
          disciplineScore: 72,
          emotionalStabilityScore: 61,
          consistencyScore: 55,
          engagementScore: 88,
        })}
      />,
    );
    for (const label of ['Discipline', 'Stabilité', 'Cohérence', 'Engagement']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  it('shows an honest « non calculé » for a null dimension instead of a fake 0', () => {
    const { container } = render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION()}
        score={score({ consistencyScore: null })}
      />,
    );
    // Repo convention (harmonised with the scoring cards): « non calculé »,
    // never a fabricated 0 and never the « N/A » anglicism.
    expect(screen.getByText('non calculé')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Cohérence0');
    expect(container.textContent).not.toContain('N/A');
  });

  it('renders the empty-state line when no snapshot exists yet', () => {
    render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={new Date().toISOString()}
        disengaged={false}
        attention={ATTENTION()}
        score={null}
      />,
    );
    expect(screen.getByText(/En attente du premier calcul/)).toBeInTheDocument();
    expect(screen.queryByText('Discipline')).not.toBeInTheDocument();
  });
});

// Anti Black-Hat (SPEC §2 posture) — the banner is a calm coaching read, never a
// punitive verdict. No red tone in ANY state: not on décrochage, not on open
// discrepancies, not on a null score.
describe('MemberSynthesisBanner — never punitive red', () => {
  it('emits no bad tone and no var(--bad) across the worst-case state', () => {
    const { container } = render(
      <MemberSynthesisBanner
        memberId="m1"
        lastSeenAt={null}
        disengaged
        attention={ATTENTION({
          tradesToComment: 9,
          openDiscrepancies: 5,
          constancyDeclining: true,
        })}
        score={score({ disciplineScore: null, consistencyScore: null })}
      />,
    );
    expect(container.querySelectorAll('[data-tone="bad"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('var(--bad)');
  });
});
