// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MindsetTimeline } from './mindset-timeline';
import type { SerializedMindsetCheck } from '@/lib/mindset/service';

afterEach(cleanup);

const CHECK = (over: Partial<SerializedMindsetCheck> = {}): SerializedMindsetCheck => ({
  id: 'c1',
  userId: 'u1',
  weekStart: '2026-06-29',
  weekEnd: '2026-07-05',
  instrumentVersion: 1,
  responses: { d1_i1: 4, d1_i2: 3 },
  createdAt: '2026-06-29T08:00:00.000Z',
  updatedAt: '2026-06-29T08:00:00.000Z',
  ...over,
});

describe('MindsetTimeline — frise auto-évaluations (SPEC §27.4)', () => {
  it('liste vide : invite calme, pas de frise', () => {
    render(<MindsetTimeline checks={[]} />);
    expect(screen.getByText(/Aucune auto-évaluation pour l'instant/)).toBeInTheDocument();
  });

  it('affiche la semaine et le profil global pour un check valide', () => {
    render(<MindsetTimeline checks={[CHECK()]} timezone="Europe/Paris" />);
    // Both week-range days are rendered as <time> elements.
    expect(screen.getByText('29 juin')).toBeInTheDocument();
    expect(screen.getByText('5 juil.')).toBeInTheDocument();
  });

  // Regression (bug /mindset "message d'erreur à chaque navigation") : a member
  // whose `timezone` column holds a non-IANA string (legacy / manual data)
  // must NOT crash the timeline. The core date-lib already falls back to UTC
  // on an invalid tz (lib/checkin/timezone.ts) ; the display formatter here
  // must be just as defensive instead of throwing a RangeError that bubbles to
  // the /mindset segment error boundary.
  it('ne jette pas avec un timezone invalide (fallback défensif)', () => {
    expect(() =>
      render(<MindsetTimeline checks={[CHECK()]} timezone="Europe/Pariss" />),
    ).not.toThrow();
    // The row still renders its week label (the formatter degraded gracefully).
    expect(screen.getByText('29 juin')).toBeInTheDocument();
  });

  it('ne jette pas avec un timezone vide', () => {
    expect(() => render(<MindsetTimeline checks={[CHECK()]} timezone="" />)).not.toThrow();
    expect(screen.getByText('29 juin')).toBeInTheDocument();
  });
});
