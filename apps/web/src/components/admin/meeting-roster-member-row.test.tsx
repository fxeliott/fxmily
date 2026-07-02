// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingRosterMemberRow } from './meeting-roster-member-row';
import type { MeetingRosterMemberView } from '@/lib/meeting/service';

// The row renders PresenceMarkControl, which imports the 'use server' action
// module (server-only auth/db). Mock it so the tree renders in jsdom.
vi.mock('@/app/admin/reunions/actions', () => ({
  markPresenceAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function makeMember(overrides: Partial<MeetingRosterMemberView>): MeetingRosterMemberView {
  return {
    memberId: 'u1',
    displayName: 'Alice Martin',
    state: 'complete',
    memberDeclaredAbsent: false,
    adminPresent: null,
    gap: 'none',
    ...overrides,
  };
}

/**
 * F4 — pins the per-meeting roster row: identity + self-report state + the
 * distinct "owned absence" badge + the reused marking control (present/absent).
 */
describe('MeetingRosterMemberRow', () => {
  function renderRow(overrides: Partial<MeetingRosterMemberView>, markable = true) {
    render(
      <ul>
        <MeetingRosterMemberRow member={makeMember(overrides)} meetingId="m1" markable={markable} />
      </ul>,
    );
  }

  it('shows the member identity, their state, and the marking control', () => {
    renderRow({ displayName: 'Alice Martin', state: 'complete' });

    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('Complète')).toBeInTheDocument();
    // PresenceMarkControl affordances are present + enabled.
    const presentBtn = screen.getByRole('button', { name: /présent/i });
    expect(presentBtn).toBeInTheDocument();
    expect(presentBtn).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /absent/i })).toBeInTheDocument();
  });

  it('badges an OWNED absence distinctly from a silent one', () => {
    renderRow({ state: 'absent', memberDeclaredAbsent: true });

    expect(screen.getByText('Rien déclaré')).toBeInTheDocument();
    expect(screen.getByText('A déclaré absent')).toBeInTheDocument();
  });

  it('does NOT show the owned-absence badge for a silent member', () => {
    renderRow({ state: 'absent', memberDeclaredAbsent: false });

    expect(screen.getByText('Rien déclaré')).toBeInTheDocument();
    expect(screen.queryByText('A déclaré absent')).not.toBeInTheDocument();
  });

  it('surfaces the admin↔membre over-claim écart calmly (never red)', () => {
    renderRow({
      state: 'complete',
      adminPresent: false,
      gap: 'admin_absent_member_present',
    });

    // The cross-check badge from PresenceMarkControl (warn tone, coaching signal).
    expect(screen.getByText(/Écart : déclarée complète, notée absente/i)).toBeInTheDocument();
  });

  it('disables the marking control on a cancelled slot', () => {
    renderRow({ state: 'cancelled' }, false);

    expect(screen.getByRole('button', { name: /présent/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /absent/i })).toBeDisabled();
  });
});
