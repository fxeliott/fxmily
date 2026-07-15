// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { QualifyingRowView } from '@/lib/leaderboard/service';

import { QualifyingSection } from './qualifying-section';

/**
 * QualifyingSection — the "Xj/N" progress must stay a VALID, honest fraction.
 *
 * The qualification gate can shrink below the raw activeDays (justified off-days
 * relax `minActiveDays`), and a legacy snapshot can carry `activeDays` from the
 * fallback chain while still being rank null. Either case can leave
 * `activeDays >= minActiveDays` on a row that is still "En qualification". The
 * component must clamp so it never renders an invalid "5j/3" nor an
 * `aria-valuenow` above `aria-valuemax` (ARIA 1.2 requires now <= max).
 */

function row(over: Partial<QualifyingRowView> = {}): QualifyingRowView {
  return {
    userId: 'u1',
    firstName: 'Alex',
    avatarUrl: null,
    initials: 'AL',
    activeDays: 2,
    minActiveDays: 7,
    isViewer: false,
    ...over,
  };
}

afterEach(() => cleanup());

describe('QualifyingSection — progress clamp (J3 SCOPE 1 hardening)', () => {
  it('renders an honest "Xj/N" fraction and valid ARIA for a normal row', () => {
    render(<QualifyingSection rows={[row({ activeDays: 2, minActiveDays: 7 })]} />);

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    // The "2j/7" pair is split across two aria-hidden spans.
    expect(bar.closest('div')?.textContent).toMatch(/2j\/7/);
  });

  it('clamps activeDays >= minActiveDays (relaxed gate) so it never shows "5j/3"', () => {
    render(<QualifyingSection rows={[row({ activeDays: 5, minActiveDays: 3 })]} />);

    const bar = screen.getByRole('progressbar');
    // now must not exceed max (ARIA validity) and the fraction must read "3j/3".
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('3');
    expect(bar.closest('div')?.textContent).toMatch(/3j\/3/);
    expect(bar.closest('div')?.textContent).not.toMatch(/5j\/3/);
  });

  it('guards a zero/stale minActiveDays so the denominator is never < 1', () => {
    render(<QualifyingSection rows={[row({ activeDays: 4, minActiveDays: 0 })]} />);

    const bar = screen.getByRole('progressbar');
    // safeMax = max(1, 0) = 1, shown = min(4, 1) = 1 → "1j/1", valid ARIA.
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('1');
    expect(bar.closest('div')?.textContent).toMatch(/1j\/1/);
  });
});
