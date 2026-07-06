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
 * Tour 15 — RUNTIME behaviour of the « attente informée » poller, measured with
 * fake timers + a mocked `fetch` (real setInterval / visibilitychange, not a
 * "should work" claim). The tour 14 version `router.refresh()`-ed on every tick
 * (7 DB reads each); tour 15 polls the light /pending-count endpoint and only
 * refreshes when the count CHANGES:
 *   - polls on the interval while a proof is pending, but does NOT refresh while
 *     the fetched count still equals the server baseline;
 *   - refreshes exactly once when the fetched count differs (a verdict landed);
 *   - never polls / refreshes when nothing is pending (no timer armed);
 *   - suspends fetching while the tab is hidden, resumes on the visibility event;
 *   - tears down its interval + aborts in-flight fetch on unmount.
 * POLL_INTERVAL_MS = 10_000 (component constant).
 */

const POLL_INTERVAL_MS = 10_000;

/** Force document.visibilityState (jsdom leaves it read-only 'visible' by default). */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Mocked fetch that always resolves { pending } for the count endpoint. */
function mockPending(value: number) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ pending: value }),
  } as unknown as Response);
}

const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProofAnalysisPoller — runtime poll behaviour (Tour 15)', () => {
  it('polls the light endpoint but does NOT refresh while the count is unchanged', async () => {
    mockPending(1); // baseline = 1, endpoint keeps returning 1
    render(<ProofAnalysisPoller pendingCount={1} />);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    // It polled the cheap endpoint...
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/verification/pending-count');
    // ...but never triggered the expensive full refresh (nothing changed).
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('refreshes exactly once when the fetched count drops below the baseline', async () => {
    mockPending(0); // a verdict landed: 1 pending -> 0
    render(<ProofAnalysisPoller pendingCount={1} />);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // The poll stopped after the change; extra time adds no further refreshes.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('never polls when nothing is pending (no timer armed)', async () => {
    render(<ProofAnalysisPoller pendingCount={0} />);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('suspends fetching while the tab is hidden and resumes when it becomes visible', async () => {
    mockPending(1); // unchanged count so we can assert on fetch, not refresh
    render(<ProofAnalysisPoller pendingCount={1} />);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    // Ticks fired but each one bails because the tab is hidden — no fetch.
    expect(fetchMock).not.toHaveBeenCalled();

    // Becoming visible triggers an immediate catch-up poll.
    setVisibility('visible');
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('tears down its interval on unmount (no leaked polls)', async () => {
    mockPending(1);
    const { unmount } = render(<ProofAnalysisPoller pendingCount={1} />);
    unmount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
