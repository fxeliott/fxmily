// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MomentumHistoryPoint } from '@/lib/scoring/momentum';

import { MomentumCard } from './momentum-card';

afterEach(cleanup);

/** 7 weekly points spanning exactly the 42-day window (anchored on the last). */
const WEEKLY_DATES = [
  '2026-05-01',
  '2026-05-08',
  '2026-05-15',
  '2026-05-22',
  '2026-05-29',
  '2026-06-05',
  '2026-06-12',
];

function points(
  overrides: Partial<Record<keyof Omit<MomentumHistoryPoint, 'date'>, number[]>>,
): MomentumHistoryPoint[] {
  return WEEKLY_DATES.map((date, i) => ({
    date,
    discipline: overrides.discipline?.[i] ?? null,
    emotionalStability: overrides.emotionalStability?.[i] ?? null,
    consistency: overrides.consistency?.[i] ?? null,
    engagement: overrides.engagement?.[i] ?? null,
  }));
}

describe('MomentumCard — calm member-facing drift signal (S22, posture §2)', () => {
  it('renders NOTHING when no dimension is in sustained decline (healthy)', () => {
    const { container } = render(
      <MomentumCard history={points({ discipline: [70, 71, 70, 72, 71, 72, 73] })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders NOTHING below the minimum sample size (honest, no fabricated trend)', () => {
    const thin: MomentumHistoryPoint[] = [
      {
        date: '2026-06-01',
        discipline: 80,
        emotionalStability: 80,
        consistency: null,
        engagement: null,
      },
      {
        date: '2026-06-08',
        discipline: 60,
        emotionalStability: 60,
        consistency: null,
        engagement: null,
      },
    ];
    const { container } = render(<MomentumCard history={thin} />);
    expect(container.firstChild).toBeNull();
  });

  it('surfaces a sustained decline as a CALM, non-punitive process nudge', () => {
    render(
      <MomentumCard
        history={points({
          emotionalStability: [82, 80, 77, 74, 72, 69, 66], // ~ -2.7 pts/week
          discipline: [71, 70, 71, 72, 71, 72, 71], // flat → not flagged
        })}
      />,
    );
    const card = document.querySelector('[data-slot="momentum-card"]');
    expect(card).not.toBeNull();
    // The drifting dimension is named (label "Stabilité"), with the word-spacing
    // intact — regression guard for the SWC quirk that dropped the space between
    // a JSX expression and an entity-bearing word ("stabilités'est"), S22.
    expect(screen.getByText(/tassée/i)).toBeInTheDocument();
    expect(card?.textContent ?? '').toMatch(/stabilité s['’]est tassée/i);
    // Mark Douglas process framing present.
    expect(card?.textContent ?? '').toMatch(/process/i);
    // NEVER a punitive / alarmist verdict (the sensitive invariant §2/§31.2).
    expect(card?.textContent ?? '').not.toMatch(
      /fais mieux|tu baisses|ressaisis|verdict|urgent\b|rattrape/i,
    );
    // Calm de-dramatising framing is explicit.
    expect(card?.textContent ?? '').toMatch(/rien d'alarmant|repère/i);
  });

  it('agrees grammatically for a MASCULINE dimension (engagement → "Ton ... tassé")', () => {
    render(
      <MomentumCard
        history={points({
          engagement: [80, 77, 74, 71, 68, 65, 62], // masculine label "Engagement"
        })}
      />,
    );
    const card = document.querySelector('[data-slot="momentum-card"]');
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';
    // Masculine: "Ton engagement s'est tassé doucement" — NOT "Ta engagement",
    // NOT the feminine "tassée" (the suffix " doucement" disambiguates tassé/tassée).
    expect(text).toMatch(/ton engagement s['’]est tassé doucement/i);
    expect(text).not.toMatch(/ta engagement/i);
    expect(text).not.toMatch(/engagement s['’]est tassée/i);
  });

  it('shows only ONE card (the steepest) when several dimensions drift — never a wall of failings', () => {
    render(
      <MomentumCard
        history={points({
          emotionalStability: [82, 78, 73, 68, 63, 58, 53], // steepest
          discipline: [80, 79, 77, 76, 75, 74, 73], // also declining, gentler
        })}
      />,
    );
    expect(document.querySelectorAll('[data-slot="momentum-card"]')).toHaveLength(1);
    // The steepest (Stabilité) is the one surfaced.
    const card = document.querySelector('[data-slot="momentum-card"]');
    expect(card?.textContent ?? '').toMatch(/stabilit/i);
  });
});
