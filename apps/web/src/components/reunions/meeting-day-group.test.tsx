// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { civilDayKey, groupMeetingsByDay, MeetingDayGroup } from './meeting-day-group';
import type { MemberMeetingView } from '@/lib/meeting/service';

// The card renders MeetingDeclareForm, which imports the 'use server' action
// module (server-only auth/db). Mock it so the component tree renders in jsdom.
vi.mock('@/app/reunions/actions', () => ({
  declareMeetingAttendanceAction: vi.fn(),
  declareMeetingAbsenceAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

vi.setConfig({ testTimeout: 15000 });

/**
 * F4 « vue à la journée » — pins the grouping logic (civil-day bucketing at the
 * Europe/Paris midnight, 12h→20h slot order within a day, newest-day-first
 * ordering) and that the day header renders while the card drops its redundant
 * date.
 */

function makeMeeting(overrides: Partial<MemberMeetingView>): MemberMeetingView {
  return {
    id: 'm1',
    slot: 'midday',
    scheduledAt: '2026-06-30T10:00:00.000Z',
    status: 'scheduled',
    displayState: 'en_attente',
    attendanceMode: null,
    contentReviewed: false,
    memberDeclaredAbsent: false,
    declarable: true,
    adminPresent: null,
    gap: 'none',
    ...overrides,
  };
}

describe('groupMeetingsByDay', () => {
  it('groups the two slots of one civil day together', () => {
    const days = groupMeetingsByDay(
      [
        makeMeeting({ id: 'e', slot: 'evening', scheduledAt: '2026-06-30T18:00:00.000Z' }),
        makeMeeting({ id: 'm', slot: 'midday', scheduledAt: '2026-06-30T10:00:00.000Z' }),
      ],
      'Europe/Paris',
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe('2026-06-30');
    // Re-sorted chronologically within the day: 12h (midday) before 20h (evening).
    expect(days[0]?.meetings.map((m) => m.id)).toEqual(['m', 'e']);
  });

  it('preserves newest-day-first ordering from the loader (desc)', () => {
    const days = groupMeetingsByDay(
      [
        makeMeeting({ id: 'a', scheduledAt: '2026-06-30T10:00:00.000Z' }),
        makeMeeting({ id: 'b', scheduledAt: '2026-06-29T10:00:00.000Z' }),
      ],
      'Europe/Paris',
    );
    expect(days.map((d) => d.date)).toEqual(['2026-06-30', '2026-06-29']);
  });

  it('splits meetings across the Europe/Paris midnight boundary (not UTC)', () => {
    // Summer (CEST = UTC+2): 21:30Z = 23:30 Paris (30 June) · 22:30Z = 00:30 Paris (1 July).
    const days = groupMeetingsByDay(
      [
        makeMeeting({ id: 'late', slot: 'evening', scheduledAt: '2026-06-30T22:30:00.000Z' }),
        makeMeeting({ id: 'early', slot: 'evening', scheduledAt: '2026-06-30T21:30:00.000Z' }),
      ],
      'Europe/Paris',
    );
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-06-30']);
  });

  it('buckets by the MEMBER timezone (F2) — the same instant lands on different civil days', () => {
    // 2026-06-30T22:30Z = 1 July 00:30 in Paris (CEST) but 30 June 18:30 in
    // New York (EDT) — the member-tz grouping is what F2 promises.
    const meetings = [
      makeMeeting({ id: 'x', slot: 'evening', scheduledAt: '2026-06-30T22:30:00.000Z' }),
    ];
    expect(groupMeetingsByDay(meetings, 'Europe/Paris')[0]?.date).toBe('2026-07-01');
    expect(groupMeetingsByDay(meetings, 'America/New_York')[0]?.date).toBe('2026-06-30');
  });
});

describe('MeetingDayGroup', () => {
  it('renders the human day header and collapses the card date', () => {
    render(
      <MeetingDayGroup
        day={{
          date: '2026-06-30',
          meetings: [makeMeeting({ id: 'm', slot: 'midday' })],
        }}
        timezone="Europe/Paris"
      />,
    );
    // Day header carries the full date (midi-UTC guard → 30 June, never 29).
    expect(screen.getByRole('heading', { name: /30 juin/i })).toBeInTheDocument();
    // The card title collapses to the slot only (showDate=false) — no repeated
    // date. 10:00Z = 12h Paris (CEST): the slot time now derives from the
    // instant + member tz (F2), no longer from a hardcoded slot→"12h" map.
    expect(screen.getByText('Réunion 12h')).toBeInTheDocument();
  });
});

describe('civilDayKey', () => {
  it('resolves the civil day in the member timezone (same instant, different days)', () => {
    // 2026-06-30T22:30Z = 1 July 00:30 Paris (CEST) but 30 June 18:30 New York (EDT).
    expect(civilDayKey('2026-06-30T22:30:00.000Z', 'Europe/Paris')).toBe('2026-07-01');
    expect(civilDayKey('2026-06-30T22:30:00.000Z', 'America/New_York')).toBe('2026-06-30');
  });
});

describe('MeetingDayGroup — today highlight (F4)', () => {
  it('renders the « Aujourd’hui » pill and enriches the section label when isToday', () => {
    render(
      <MeetingDayGroup
        day={{ date: '2026-06-30', meetings: [makeMeeting({ id: 'm', slot: 'midday' })] }}
        timezone="Europe/Paris"
        isToday
      />,
    );
    expect(screen.getByText('Aujourd’hui')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /aujourd’hui/i })).toBeInTheDocument();
  });

  it('stays plain (no pill) for any other day — the default', () => {
    render(
      <MeetingDayGroup
        day={{ date: '2026-06-30', meetings: [makeMeeting({ id: 'm', slot: 'midday' })] }}
        timezone="Europe/Paris"
      />,
    );
    expect(screen.queryByText('Aujourd’hui')).not.toBeInTheDocument();
  });
});

describe('MeetingDayGroup — explicit absence affordance (F4)', () => {
  it('offers the calm "je n\'ai pas pu y assister" action when not yet declared absent', () => {
    render(
      <MeetingDayGroup
        day={{ date: '2026-06-30', meetings: [makeMeeting({ id: 'm', slot: 'midday' })] }}
        timezone="Europe/Paris"
      />,
    );
    // A single low-friction tap, never red (§31.2).
    expect(screen.getByRole('button', { name: /pas pu y assister/i })).toBeInTheDocument();
  });

  it('replaces the action with a calm status note once the absence is declared', () => {
    render(
      <MeetingDayGroup
        day={{
          date: '2026-06-30',
          meetings: [
            makeMeeting({
              id: 'm',
              slot: 'midday',
              displayState: 'absent',
              memberDeclaredAbsent: true,
            }),
          ],
        }}
        timezone="Europe/Paris"
      />,
    );
    // No more absence button (already declared) — a note explains how to correct.
    expect(screen.queryByRole('button', { name: /pas pu y assister/i })).not.toBeInTheDocument();
    expect(screen.getByText(/indiqué ne pas avoir pu y assister/i)).toBeInTheDocument();
  });
});
