// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerializedMonthlyProfileSnapshot } from '@/lib/member-profile-monthly/types';

// Tour 11 — the shared `deep-dimension-sections` module now exports the
// signal-seeding client island which references a server action. Mock it so
// this presentational test never pulls NextAuth/next-cache (same pattern as
// `member-verification-panel.test.tsx`). This panel itself stays read-only
// (it never passes `memberId`).
vi.mock('@/app/admin/members/[id]/objective-from-signal-actions', () => ({
  seedObjectiveFromSignalAction: vi.fn().mockResolvedValue({ ok: true, status: 'created' }),
}));

import { MemberMonthlyProfileTrajectoryPanel } from './member-monthly-profile-trajectory-panel';

/**
 * J-E inc.3 — admin monthly re-profiling trajectory. Pins: a card per month
 * (newest first) with the evolution narrative + the 4 deep dims reusing the
 * shared renderer, a valid heading outline (h2 panel → h3 month → h4 dims),
 * per-month namespaced heading ids (no collision across months), exactly ONE
 * AI Act art.50 banner, honest empty state, and graceful degradation to the
 * narrative alone when the 4 dims are null.
 */

afterEach(cleanup);

const DIMS = {
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
      priority: 3,
      evidence: ['4 sur 10'],
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

function snap(
  over: Partial<SerializedMonthlyProfileSnapshot> = {},
): SerializedMonthlyProfileSnapshot {
  return {
    id: 'mps_1',
    userId: 'user_1',
    monthStart: '2026-06-01',
    monthEnd: '2026-06-30',
    generatedAt: '2026-07-01T09:00:00.000Z',
    evolutionNarrative:
      'Ce mois, le respect du plan progresse nettement vs le point de depart onboarding.',
    coachingTone: null,
    learningStage: null,
    axesStructured: null,
    weakSignals: null,
    claudeModel: 'claude-opus-4-8',
    ...over,
  };
}

describe('MemberMonthlyProfileTrajectoryPanel — J-E monthly trajectory', () => {
  it('renders the honest empty state when there is no snapshot', () => {
    render(<MemberMonthlyProfileTrajectoryPanel snapshots={[]} />);
    expect(screen.getByText('Aucun re-profilage mensuel pour ce membre.')).toBeInTheDocument();
    // No AI banner when there is nothing AI-derived to disclose.
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  it('renders a card per month (newest first) with narrative + all 4 dims', () => {
    render(
      <MemberMonthlyProfileTrajectoryPanel
        snapshots={[
          snap({ id: 'm_jun', monthStart: '2026-06-01', ...DIMS }),
          snap({
            id: 'm_may',
            monthStart: '2026-05-01',
            monthEnd: '2026-05-31',
            evolutionNarrative: 'En mai, la patience sur les setups A+ commence a s installer.',
            ...DIMS,
          }),
        ]}
      />,
    );

    // Both month labels (formatMonthLabelFr) + both narratives.
    expect(screen.getByText('Juin 2026')).toBeInTheDocument();
    expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    expect(screen.getByText(/le respect du plan progresse nettement/)).toBeInTheDocument();
    expect(screen.getByText(/la patience sur les setups A\+/)).toBeInTheDocument();

    // Each of the 4 dims renders once PER month (2 months → 2 occurrences).
    expect(screen.getAllByText('Registre de coaching suggéré')).toHaveLength(2);
    expect(screen.getAllByText("Stade d'apprentissage")).toHaveLength(2);
    expect(screen.getAllByText('Axes prioritaires structurés')).toHaveLength(2);
    expect(screen.getAllByText('Signaux faibles à observer')).toHaveLength(2);
  });

  it('exposes a valid heading outline: h2 panel > h3 month > h4 dims', () => {
    render(
      <MemberMonthlyProfileTrajectoryPanel
        snapshots={[snap({ id: 'm_jun', monthStart: '2026-06-01', ...DIMS })]}
      />,
    );
    expect(screen.getByText('Trajectoire mensuelle du profil').tagName).toBe('H2');
    expect(screen.getByText('Juin 2026').tagName).toBe('H3');
    // The extracted dim sections drop to h4 under the per-month h3.
    expect(document.getElementById('trajectoire-2026-06-01-tone-heading')?.tagName).toBe('H4');
    expect(document.getElementById('trajectoire-2026-06-01-axes-structured-heading')?.tagName).toBe(
      'H4',
    );
  });

  it('namespaces dim heading ids per month so nothing collides', () => {
    render(
      <MemberMonthlyProfileTrajectoryPanel
        snapshots={[
          snap({ id: 'm_jun', monthStart: '2026-06-01', ...DIMS }),
          snap({ id: 'm_may', monthStart: '2026-05-01', monthEnd: '2026-05-31', ...DIMS }),
        ]}
      />,
    );
    // Distinct ids, each present exactly once (no duplicate-id in the document).
    expect(document.querySelectorAll('[id="trajectoire-2026-06-01-tone-heading"]')).toHaveLength(1);
    expect(document.querySelectorAll('[id="trajectoire-2026-05-01-tone-heading"]')).toHaveLength(1);
  });

  it('renders exactly one AI Act art.50 banner covering the whole block', () => {
    render(
      <MemberMonthlyProfileTrajectoryPanel
        snapshots={[
          snap({ id: 'm_jun', monthStart: '2026-06-01', ...DIMS }),
          snap({ id: 'm_may', monthStart: '2026-05-01', monthEnd: '2026-05-31', ...DIMS }),
        ]}
      />,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });

  it('degrades gracefully to the narrative alone when the 4 dims are null', () => {
    render(
      <MemberMonthlyProfileTrajectoryPanel
        snapshots={[snap({ id: 'm_jun', monthStart: '2026-06-01' })]}
      />,
    );
    // Month + narrative still render (the value-add survives a low-signal month).
    expect(screen.getByText('Juin 2026')).toBeInTheDocument();
    expect(screen.getByText(/le respect du plan progresse nettement/)).toBeInTheDocument();
    // But no dim section appears.
    expect(screen.queryByText('Registre de coaching suggéré')).toBeNull();
    expect(screen.queryByText('Signaux faibles à observer')).toBeNull();
  });

  it('ignores malformed dim payloads instead of crashing', () => {
    expect(() =>
      render(
        <MemberMonthlyProfileTrajectoryPanel
          snapshots={[
            snap({
              id: 'm_jun',
              monthStart: '2026-06-01',
              coachingTone: { register: 'not_a_valid_enum' },
              weakSignals: 'garbage',
            }),
          ]}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByText('Registre de coaching suggéré')).toBeNull();
    expect(screen.queryByText('Signaux faibles à observer')).toBeNull();
  });
});
