// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckinDayList, groupCheckinsByDay } from './checkin-day-list';
import type { SerializedCheckin } from '@/lib/checkin/service';

afterEach(() => {
  cleanup();
});

// jsdom env startup can spike past 5s on cold Windows filesystem — bump timeout.
vi.setConfig({ testTimeout: 15000 });

/**
 * F7 Layer 2 — the shared day-by-day renderer used by both the member
 * `/checkin/history` page and the admin panel. These tests pin: day grouping
 * (morning+evening of one date collapse to a single card), the « rattrapage »
 * badge + justification (the F7 value-add), and the empty-state passthrough.
 */

function makeCheckin(overrides: Partial<SerializedCheckin>): SerializedCheckin {
  return {
    id: 'c1',
    userId: 'u1',
    date: '2026-06-05',
    slot: 'morning',
    sleepHours: null,
    sleepQuality: null,
    morningRoutineCompleted: null,
    marketAnalysisDone: null,
    meditationMin: null,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    planRespectedToday: null,
    hedgeRespectedToday: null,
    intentionKept: null,
    formationFollowed: null,
    caffeineMl: null,
    waterLiters: null,
    stressScore: null,
    gratitudeItems: [],
    moodScore: null,
    emotionTags: [],
    journalNote: null,
    lateJustification: null,
    backfilledAt: null,
    submittedAt: '2026-06-05T20:00:00.000Z',
    createdAt: '2026-06-05T20:00:00.000Z',
    updatedAt: '2026-06-05T20:00:00.000Z',
    ...overrides,
  };
}

describe('groupCheckinsByDay', () => {
  it('collapses morning + evening of the same date into one group', () => {
    const groups = groupCheckinsByDay([
      makeCheckin({ id: 'm', slot: 'morning', date: '2026-06-05' }),
      makeCheckin({ id: 'e', slot: 'evening', date: '2026-06-05' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.morning?.id).toBe('m');
    expect(groups[0]?.evening?.id).toBe('e');
  });

  it('preserves the loader ordering across distinct dates', () => {
    const groups = groupCheckinsByDay([
      makeCheckin({ slot: 'morning', date: '2026-06-06' }),
      makeCheckin({ slot: 'morning', date: '2026-06-05' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-06-06', '2026-06-05']);
  });
});

describe('CheckinDayList', () => {
  it('renders the passed empty-state when there are no check-ins', () => {
    render(<CheckinDayList checkins={[]} emptyState={<p>Aucun check-in ici.</p>} />);
    expect(screen.getByText('Aucun check-in ici.')).toBeInTheDocument();
  });

  it('shows the « Rattrapage » badge + justification on a backfilled slot', () => {
    render(
      <CheckinDayList
        checkins={[
          makeCheckin({
            slot: 'evening',
            date: '2026-06-05',
            backfilledAt: '2026-06-10T09:00:00.000Z',
            lateJustification: 'Panne internet la veille.',
          }),
        ]}
        emptyState={<p>vide</p>}
      />,
    );
    expect(screen.getByText('Rattrapage')).toBeInTheDocument();
    expect(screen.getByText('Panne internet la veille.')).toBeInTheDocument();
  });

  it('does NOT show the « Rattrapage » badge on an on-time slot', () => {
    render(
      <CheckinDayList
        checkins={[makeCheckin({ slot: 'morning', date: '2026-06-05', backfilledAt: null })]}
        emptyState={<p>vide</p>}
      />,
    );
    expect(screen.queryByText('Rattrapage')).toBeNull();
  });
});

describe('CheckinDayList — Tour 14 jour off', () => {
  it('un slot vide sur un jour off lit « Jour off » (pas « Non rempli. »)', () => {
    render(
      <CheckinDayList
        // Un seul slot rempli (matin) le jour off → le soir vide doit lire « Jour off ».
        checkins={[makeCheckin({ slot: 'morning', date: '2026-06-06' })]}
        offDates={new Set(['2026-06-06'])}
        emptyState={<p>vide</p>}
      />,
    );
    // Pill « Off » dans l'en-tête + « Jour off » sur le slot du soir vide.
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('Jour off')).toBeInTheDocument();
    expect(screen.queryByText('Non rempli.')).toBeNull();
  });

  it('sans offDates, un slot vide garde « Non rempli. » (comportement inchangé)', () => {
    render(
      <CheckinDayList
        checkins={[makeCheckin({ slot: 'morning', date: '2026-06-05' })]}
        emptyState={<p>vide</p>}
      />,
    );
    expect(screen.getByText('Non rempli.')).toBeInTheDocument();
    expect(screen.queryByText('Off')).toBeNull();
  });
});

describe('CheckinDayList — F7 §33.2 admin reuse signal', () => {
  const backfilled = makeCheckin({
    id: 'bf1',
    slot: 'evening',
    date: '2026-06-05',
    backfilledAt: '2026-06-10T09:00:00.000Z',
    lateJustification: 'Panne internet.',
  });

  it('shows the admin « Réutilisée » badge when repeatSignals flags the id', () => {
    render(
      <CheckinDayList
        checkins={[backfilled]}
        repeatSignals={new Map([['bf1', 2]])}
        emptyState={<p>vide</p>}
      />,
    );
    expect(screen.getByText(/Réutilisée/)).toBeInTheDocument();
  });

  it('hides the reuse badge on the member surface (no repeatSignals passed)', () => {
    render(<CheckinDayList checkins={[backfilled]} emptyState={<p>vide</p>} />);
    // The rattrapage badge still shows (member sees their own justification)...
    expect(screen.getByText('Rattrapage')).toBeInTheDocument();
    // ...but never the admin-only reuse verdict.
    expect(screen.queryByText(/Réutilisée/)).toBeNull();
  });
});
