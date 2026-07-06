// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the three off-day Server Actions (repo canon — cf. timezone-select.test.tsx:
// `vi.mock` is hoisted, so the fns live in `vi.hoisted`). Defaults resolve OK;
// per-test overrides drive the failure branches.
const { declareRangeMock, cancelMock, weekendsMock } = vi.hoisted(() => ({
  declareRangeMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancelMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  weekendsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('@/app/checkin/off-day-actions', () => ({
  declareOffDayRangeAction: declareRangeMock,
  cancelOffDayAction: cancelMock,
  updateWeekendsOffAction: weekendsMock,
}));

import { OffDaysManager } from './off-days-manager';

afterEach(() => {
  cleanup();
  declareRangeMock.mockReset();
  cancelMock.mockReset();
  weekendsMock.mockReset();
});

/**
 * Tour 15 — the behaviour a member actually relies on: an absence they just
 * posted must APPEAR in the « Jours off à venir » list right away (prod-proven
 * gap: the row only showed after a reload, which reads as a failed save).
 */

function renderManager(
  upcoming: Array<{ date: string; label: string; reason: string | null }> = [],
) {
  return render(
    <OffDaysManager initialWeekendsOff initialUpcoming={upcoming} todayLocal="2026-07-06" />,
  );
}

function fillRange(from: string, to: string) {
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: to } });
}

describe('OffDaysManager — optimistic upcoming list', () => {
  it('shows the freshly-declared days immediately, without a reload', async () => {
    declareRangeMock.mockResolvedValue({
      ok: true,
      from: '2026-07-07',
      to: '2026-07-08',
      days: 2,
      upcoming: [
        { date: '2026-07-07', label: 'mardi 7 juillet', reason: 'Repos' },
        { date: '2026-07-08', label: 'mercredi 8 juillet', reason: 'Repos' },
      ],
    });
    renderManager();

    expect(screen.queryByText('Jours off à venir')).toBeNull();
    fillRange('2026-07-07', '2026-07-08');
    fireEvent.click(screen.getByRole('button', { name: /Poser ces jours off/ }));

    await waitFor(() => {
      expect(screen.getByText('Jours off à venir')).toBeTruthy();
    });
    expect(screen.getByText('mardi 7 juillet')).toBeTruthy();
    expect(screen.getByText('mercredi 8 juillet')).toBeTruthy();
    expect(screen.getByText('Tes 2 jours off sont enregistrés.')).toBeTruthy();
  });

  it('dedupes on date (re-declaring updates the reason) and keeps chronological order', async () => {
    declareRangeMock.mockResolvedValue({
      ok: true,
      from: '2026-07-07',
      to: '2026-07-07',
      days: 1,
      upcoming: [{ date: '2026-07-07', label: 'mardi 7 juillet', reason: 'Formation' }],
    });
    renderManager([
      { date: '2026-07-07', label: 'mardi 7 juillet', reason: 'Repos' },
      { date: '2026-07-09', label: 'jeudi 9 juillet', reason: null },
    ]);

    fillRange('2026-07-07', '2026-07-07');
    fireEvent.click(screen.getByRole('button', { name: /Poser ces jours off/ }));

    await waitFor(() => {
      expect(screen.getByText('Formation')).toBeTruthy();
    });
    // No duplicate row for the re-declared day; order stays chronological.
    expect(screen.getAllByText('mardi 7 juillet')).toHaveLength(1);
    const labels = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
      .map((t) => t.slice(0, 8));
    expect(labels).toEqual(['mardi 7 ', 'jeudi 9 '.slice(0, 8)]);
  });

  it('does not touch the list when the action fails, and announces the error', async () => {
    declareRangeMock.mockResolvedValue({ ok: false, error: 'invalid_input' });
    renderManager();

    fillRange('2026-07-07', '2026-07-08');
    fireEvent.click(screen.getByRole('button', { name: /Poser ces jours off/ }));

    await waitFor(() => {
      expect(screen.getByText(/La plage est invalide/)).toBeTruthy();
    });
    expect(screen.queryByText('Jours off à venir')).toBeNull();
  });

  it('removes a cancelled day from the list', async () => {
    cancelMock.mockResolvedValue({ ok: true, date: '2026-07-07' });
    renderManager([{ date: '2026-07-07', label: 'mardi 7 juillet', reason: null }]);

    fireEvent.click(screen.getByRole('button', { name: 'Retirer le jour off du mardi 7 juillet' }));

    await waitFor(() => {
      expect(screen.getByText('Le jour off a été retiré.')).toBeTruthy();
    });
    expect(screen.queryByText('mardi 7 juillet')).toBeNull();
  });
});
