// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the router.refresh calls the poller fires.
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { ProofAnalysisPoller } from './proof-analysis-poller';

/**
 * Tour 14 — RUNTIME behaviour of the « attente informée » poller, measured with
 * fake timers (real setInterval / visibilitychange, not a "should work" claim):
 *   - refreshes on the interval while a proof is pending;
 *   - never arms a timer (never refreshes) when nothing is pending;
 *   - suspends while the tab is hidden, resumes on the visibility event;
 *   - stops after the 30 min duration cap.
 * POLL_INTERVAL_MS = 25_000, MAX_POLL_DURATION_MS = 30 min (component constants).
 */

const POLL_INTERVAL_MS = 25_000;

/** Force document.visibilityState (jsdom leaves it read-only 'visible' by default). */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('ProofAnalysisPoller — runtime timer behaviour', () => {
  it('refreshes once per interval while a proof is pending', () => {
    render(<ProofAnalysisPoller pendingCount={1} />);
    expect(refreshMock).not.toHaveBeenCalled(); // no immediate refresh on mount

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it('never refreshes when nothing is pending (no timer armed)', () => {
    render(<ProofAnalysisPoller pendingCount={0} />);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('suspends while the tab is hidden and resumes when it becomes visible again', () => {
    render(<ProofAnalysisPoller pendingCount={2} />);

    setVisibility('hidden');
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    // Ticks fired but each one bails because the tab is hidden.
    expect(refreshMock).not.toHaveBeenCalled();

    // Becoming visible triggers an immediate catch-up refresh...
    setVisibility('visible');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // ...then the interval resumes.
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('stops refreshing after the 30 minute duration cap', () => {
    render(<ProofAnalysisPoller pendingCount={1} />);

    // 30 min / 25 s = 72 intervals. Advance well past the cap.
    vi.advanceTimersByTime(31 * 60 * 1000);
    const callsAfterCap = refreshMock.mock.calls.length;

    // Further time must not add refreshes (the cap short-circuited the tick).
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 10);
    expect(refreshMock.mock.calls.length).toBe(callsAfterCap);
    // Sanity: it did refresh a bounded number of times before the cap (≈72).
    expect(callsAfterCap).toBeGreaterThan(0);
    expect(callsAfterCap).toBeLessThanOrEqual(72);
  });

  it('tears down its interval on unmount (no leaked refreshes)', () => {
    const { unmount } = render(<ProofAnalysisPoller pendingCount={1} />);
    unmount();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
