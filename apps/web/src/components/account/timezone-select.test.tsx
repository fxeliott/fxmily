// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TimezoneOptionGroup } from '@/lib/timezones';

// The picker auto-saves via this Server Action; mock it so the test exercises
// the component's branching (optimistic update / revert / a11y), not the real
// Auth.js + Prisma write. Resolves OK by default; a per-test override drives the
// failure branch.
// `vi.mock` is hoisted above the file body, so the mock fn it references must be
// created in `vi.hoisted` (repo canon — cf. weekly-report/overdue.test.ts).
// A plain top-level `const` would be in the temporal dead zone when the hoisted
// factory runs → "Cannot access … before initialization".
const { updateTimezoneActionMock } = vi.hoisted(() => ({
  updateTimezoneActionMock: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
}));
vi.mock('@/app/account/timezone/actions', () => ({
  updateTimezoneAction: updateTimezoneActionMock,
}));

import { TimezoneSelect } from './timezone-select';

afterEach(() => {
  cleanup();
  updateTimezoneActionMock.mockReset();
  updateTimezoneActionMock.mockResolvedValue({ ok: true });
});

/**
 * F2 — `<TimezoneSelect>` member picker. These assert the LOGIC + a11y wiring
 * I rely on (not styling): the native select stays interactive while auto-saving
 * (disabling a focused control drops focus to <body>, WCAG 2.4.3), and an error
 * marks the control invalid + points at the message. The offset/catalogue math
 * is unit-tested in `lib/timezones.test.ts`.
 */

const GROUPS: TimezoneOptionGroup[] = [
  {
    region: 'Europe',
    label: 'Europe',
    options: [
      { value: 'Europe/Paris', label: 'Paris (UTC+02:00)' },
      { value: 'Europe/London', label: 'London (UTC+01:00)' },
    ],
  },
  {
    region: 'America',
    label: 'Amérique',
    options: [{ value: 'America/New_York', label: 'New York (UTC-04:00)' }],
  },
];

function getSelect(): HTMLSelectElement {
  return screen.getByRole('combobox') as HTMLSelectElement;
}

describe('TimezoneSelect — render + value', () => {
  it('renders the initial timezone as the selected option', () => {
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    expect(getSelect().value).toBe('Europe/Paris');
  });

  it('surfaces a persisted value absent from the groups as a standalone option', () => {
    // A legacy/alias value not present in the offered groups must still show as
    // the current selection (never silently blank).
    render(<TimezoneSelect initialTimezone="Indian/Reunion" groups={GROUPS} />);
    expect(getSelect().value).toBe('Indian/Reunion');
  });
});

describe('TimezoneSelect — a11y (regression guards for the F2 fix)', () => {
  it('NEVER disables the select while auto-saving (focus must not drop to <body>)', async () => {
    // A deferred resolution keeps the transition "pending" across the assertion
    // window — the select must stay enabled the whole time.
    let resolve!: (v: { ok: boolean }) => void;
    updateTimezoneActionMock.mockReturnValueOnce(
      new Promise<{ ok: boolean }>((r) => {
        resolve = r;
      }),
    );
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    const select = getSelect();

    fireEvent.change(select, { target: { value: 'America/New_York' } });
    expect(select.disabled).toBe(false); // mid-save: still interactive
    expect(select.value).toBe('America/New_York'); // optimistic

    resolve({ ok: true });
    await waitFor(() => expect(updateTimezoneActionMock).toHaveBeenCalledTimes(1));
    expect(select.disabled).toBe(false);
  });

  it('points aria-describedby at the help text by default (no error)', () => {
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    const select = getSelect();
    expect(select.getAttribute('aria-describedby')).toBe('tz-help');
    expect(select.getAttribute('aria-invalid')).toBeNull();
  });

  it('marks the select invalid + describes the error when the save fails (reverts value)', async () => {
    updateTimezoneActionMock.mockResolvedValueOnce({ ok: false });
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    const select = getSelect();

    fireEvent.change(select, { target: { value: 'America/New_York' } });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Reverted to the previous value (optimistic rollback).
    expect(select.value).toBe('Europe/Paris');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe('tz-help tz-error');
    expect(document.getElementById('tz-error')).toBeTruthy();
  });
});

describe('TimezoneSelect — persistence', () => {
  it('calls the action with the chosen timezone on change', async () => {
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    fireEvent.change(getSelect(), { target: { value: 'Europe/London' } });
    await waitFor(() =>
      expect(updateTimezoneActionMock).toHaveBeenCalledWith({ timezone: 'Europe/London' }),
    );
  });

  it('does NOT call the action when the value is unchanged', () => {
    render(<TimezoneSelect initialTimezone="Europe/Paris" groups={GROUPS} />);
    fireEvent.change(getSelect(), { target: { value: 'Europe/Paris' } });
    expect(updateTimezoneActionMock).not.toHaveBeenCalled();
  });
});
