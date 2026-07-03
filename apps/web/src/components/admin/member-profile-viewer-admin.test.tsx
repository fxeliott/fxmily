// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  SerializedMemberProfile,
  SerializedOnboardingInterview,
} from '@/lib/onboarding-interview/service';

// Tour 11 — `WeakSignalsSection` renders the `SeedObjectiveFromSignalButton`
// client island which references the server action. Mock it so this
// presentational test never pulls NextAuth/next-cache (same pattern as
// `member-verification-panel.test.tsx` / `micro-objective-card.test.tsx`).
vi.mock('@/app/admin/members/[id]/objective-from-signal-actions', () => ({
  seedObjectiveFromSignalAction: vi.fn().mockResolvedValue({ ok: true, status: 'created' }),
}));

import { MemberProfileViewerAdmin } from './member-profile-viewer-admin';

/**
 * J-C — admin surfacing of the 4 deep-AI MemberProfile dimensions
 * (coachingTone, learningStage, axesStructured, weakSignals). These assertions
 * pin: the 4 sections render when populated (French enum labels + priority VALUE
 * not index + verbatim evidence + admin-only weakSignals), graceful degradation
 * to nothing when a field is null, and a single AI Act art.50 banner covering
 * the whole AI-derived block (never one per section).
 */

afterEach(cleanup);

const INTERVIEW: SerializedOnboardingInterview = {
  id: 'oi_1',
  userId: 'user_1',
  status: 'completed',
  startedAt: '2026-05-28T10:00:00.000Z',
  completedAt: '2026-05-28T10:30:00.000Z',
  claudeModelVersion: 'claude-opus-4-8',
  instrumentVersion: 'v1',
  totalTokensInput: 0,
  totalTokensOutput: 0,
};

function profile(over: Partial<SerializedMemberProfile> = {}): SerializedMemberProfile {
  return {
    id: 'mp_1',
    userId: 'user_1',
    interviewId: 'oi_1',
    summary: 'Synthèse comportementale de preuve, assez longue pour la vue admin.',
    highlights: [],
    axesPrioritaires: [],
    claudeModelVersion: 'claude-opus-4-8',
    instrumentVersion: 'v1',
    analyzedAt: '2026-05-29T09:00:00.000Z',
    coachingTone: null,
    learningStage: null,
    axesStructured: null,
    weakSignals: null,
    ...over,
  };
}

// Priorities 3 and 5 (not 1/2) so a priority-vs-index bug is detectable.
const FULL_DIMENSIONS = {
  coachingTone: {
    register: 'socratique',
    rationale: 'Le membre progresse en questionnant ses propres raisonnements.',
    evidence: ['je remets tout en question'],
  },
  learningStage: {
    stage: 'subjective',
    rationale: 'Verbalise ses ressentis sans les relier à un process stable.',
    evidence: ['je ressens du doute'],
  },
  axesStructured: [
    {
      axis: 'Consolider la conformité au plan personnel',
      dimensionId: 'discipline_plan_adherence',
      priority: 5,
      evidence: ['4 sur 10'],
    },
    {
      axis: 'Ancrer un rituel de reprise après une perte',
      dimensionId: 'emotional_regulation',
      priority: 3,
      evidence: ['je sur-ajuste'],
    },
  ],
  weakSignals: [
    {
      signal: 'Tendance à sur-ajuster la taille après une perte.',
      dimensionId: 'discipline_plan_adherence',
      evidence: ['je sur-ajuste'],
    },
  ],
};

describe('MemberProfileViewerAdmin — J-C deep-AI dimensions', () => {
  it('renders all 4 sections when the dimensions are populated', () => {
    render(
      <MemberProfileViewerAdmin
        memberId="user_1"
        profile={profile(FULL_DIMENSIONS)}
        interview={INTERVIEW}
      />,
    );

    expect(screen.getByText('Registre de coaching suggéré')).toBeInTheDocument();
    expect(screen.getByText('Socratique')).toBeInTheDocument();

    expect(screen.getByText("Stade d'apprentissage")).toBeInTheDocument();
    expect(screen.getByText('Subjectif')).toBeInTheDocument();

    expect(screen.getByText('Axes prioritaires structurés')).toBeInTheDocument();
    expect(screen.getByText('Consolider la conformité au plan personnel')).toBeInTheDocument();
    expect(screen.getByText('Ancrer un rituel de reprise après une perte')).toBeInTheDocument();

    expect(screen.getByText('Signaux faibles à observer')).toBeInTheDocument();
    expect(
      screen.getByText('Tendance à sur-ajuster la taille après une perte.'),
    ).toBeInTheDocument();
  });

  it('shows the priority VALUE (not the list index) on structured axes', () => {
    render(
      <MemberProfileViewerAdmin
        memberId="user_1"
        profile={profile(FULL_DIMENSIONS)}
        interview={INTERVIEW}
      />,
    );
    const section = document
      .getElementById('profile-admin-axes-structured-heading')
      ?.closest('section');
    expect(section).not.toBeNull();
    // Priorities are 3 and 5; a broken index-based badge would show 1 and 2.
    expect(section?.textContent).toContain('3');
    expect(section?.textContent).toContain('5');
    // Sorted by priority ascending: the priority-3 axis text precedes priority-5.
    const text = section?.textContent ?? '';
    expect(text.indexOf('Ancrer un rituel')).toBeLessThan(text.indexOf('Consolider la conformité'));
  });

  it('renders exactly one AI Act art.50 banner covering the whole AI block', () => {
    render(
      <MemberProfileViewerAdmin
        memberId="user_1"
        profile={profile(FULL_DIMENSIONS)}
        interview={INTERVIEW}
      />,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });

  it('degrades gracefully: no dimension sections render when all 4 are null', () => {
    render(
      <MemberProfileViewerAdmin memberId="user_1" profile={profile()} interview={INTERVIEW} />,
    );

    // The legacy summary still renders (component alive).
    expect(screen.getByText('Synthèse comportementale')).toBeInTheDocument();
    // None of the 4 new sections appear.
    expect(screen.queryByText('Registre de coaching suggéré')).toBeNull();
    expect(screen.queryByText("Stade d'apprentissage")).toBeNull();
    expect(screen.queryByText('Axes prioritaires structurés')).toBeNull();
    expect(screen.queryByText('Signaux faibles à observer')).toBeNull();
  });

  it('renders only the sections that are present (partial data)', () => {
    render(
      <MemberProfileViewerAdmin
        memberId="user_1"
        profile={profile({ coachingTone: FULL_DIMENSIONS.coachingTone })}
        interview={INTERVIEW}
      />,
    );
    expect(screen.getByText('Registre de coaching suggéré')).toBeInTheDocument();
    expect(screen.queryByText("Stade d'apprentissage")).toBeNull();
    expect(screen.queryByText('Axes prioritaires structurés')).toBeNull();
    expect(screen.queryByText('Signaux faibles à observer')).toBeNull();
  });

  it('ignores malformed dimension payloads instead of crashing', () => {
    expect(() =>
      render(
        <MemberProfileViewerAdmin
          memberId="user_1"
          profile={profile({
            coachingTone: { register: 'not_a_valid_enum', rationale: 'x' },
            axesStructured: [{ nope: true }],
            weakSignals: 'garbage',
          })}
          interview={INTERVIEW}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByText('Registre de coaching suggéré')).toBeNull();
    expect(screen.queryByText('Axes prioritaires structurés')).toBeNull();
    expect(screen.queryByText('Signaux faibles à observer')).toBeNull();
  });
});
