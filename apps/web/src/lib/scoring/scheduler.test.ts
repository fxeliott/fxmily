import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_CONCURRENT_RECOMPUTES,
  __resetSchedulerForTests,
  scheduleScoreRecompute,
} from './scheduler';

/**
 * J7 stress-test proof (tracker id=9).
 *
 * The defect: the debounce map only coalesces repeated calls from the *same*
 * user. When 100 distinct members submit their evening check-in in the 21:00
 * window, `scheduleScoreRecompute` fires 100 independent `after()` callbacks,
 * each of which fans out to ~10 Prisma round-trips. Against a pg pool capped at
 * 10, an unbounded burst starves the foreground request path into
 * `connectionTimeoutMillis` throws.
 *
 * These tests drive the scheduler deterministically (no DB, no k6 replay) and
 * prove the fix: cohort-wide concurrency is BOUNDED by `MAX_CONCURRENT_RECOMPUTES`
 * regardless of cohort size, the per-user debounce still coalesces, and a slot
 * is always released on failure so the queue never deadlocks.
 */

// `after()` runs the callback post-response. We capture the callbacks instead
// so the test can drive them and control their concurrency deterministically.
const { capturedAfterCallbacks } = vi.hoisted(() => ({
  capturedAfterCallbacks: [] as Array<() => Promise<void>>,
}));

const { recomputeAndPersistMock } = vi.hoisted(() => ({
  recomputeAndPersistMock: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void>) => {
    capturedAfterCallbacks.push(cb);
  },
}));

vi.mock('./service', () => ({
  recomputeAndPersist: recomputeAndPersistMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: vi.fn(async () => {}),
}));

vi.mock('@/lib/observability', () => ({
  reportWarning: vi.fn(),
}));

vi.mock('@/lib/checkin/timezone', () => ({
  localDateOf: () => '2026-07-20',
}));

/** Drain the microtask queue enough times for the semaphore to settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await Promise.resolve();
  }
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  __resetSchedulerForTests();
  capturedAfterCallbacks.length = 0;
  recomputeAndPersistMock.mockReset();
});

describe('scheduleScoreRecompute — cohort-wide concurrency bound (J7)', () => {
  it('never runs more than MAX_CONCURRENT_RECOMPUTES recomputes at once under a 100-member burst', async () => {
    let concurrentNow = 0;
    let concurrentMax = 0;
    const gate = deferred();

    recomputeAndPersistMock.mockImplementation(async () => {
      concurrentNow += 1;
      concurrentMax = Math.max(concurrentMax, concurrentNow);
      await gate.promise;
      concurrentNow -= 1;
    });

    const COHORT = 100;
    for (let i = 0; i < COHORT; i += 1) {
      scheduleScoreRecompute(`burst-user-${i}`, 'checkin.evening.submitted', 'Europe/Paris');
    }

    // Every distinct member scheduled one background job (per-user debounce
    // can't coalesce distinct users).
    expect(capturedAfterCallbacks).toHaveLength(COHORT);

    // Start all 100 background jobs; hold their completion promises.
    const running = capturedAfterCallbacks.map((cb) => cb());

    // The semaphore admits exactly MAX; the other 97 block on a free slot.
    await flushMicrotasks();

    expect(concurrentNow).toBe(MAX_CONCURRENT_RECOMPUTES);
    expect(concurrentMax).toBe(MAX_CONCURRENT_RECOMPUTES);
    expect(recomputeAndPersistMock).toHaveBeenCalledTimes(MAX_CONCURRENT_RECOMPUTES);

    // Open the gate — the queue drains fully, still never exceeding the bound.
    gate.resolve();
    await Promise.all(running);

    expect(recomputeAndPersistMock).toHaveBeenCalledTimes(COHORT);
    expect(concurrentMax).toBe(MAX_CONCURRENT_RECOMPUTES);
    expect(concurrentNow).toBe(0);
  });

  it('coalesces repeated recomputes for the same user within the debounce window', async () => {
    recomputeAndPersistMock.mockResolvedValue(undefined);

    for (let i = 0; i < 3; i += 1) {
      scheduleScoreRecompute('same-user', 'trade.closed', 'Europe/Paris');
    }

    await Promise.all(capturedAfterCallbacks.map((cb) => cb()));

    // Only the first call in the burst actually recomputes; the rest are no-ops.
    expect(recomputeAndPersistMock).toHaveBeenCalledTimes(1);
  });

  it('releases the slot when a recompute throws so the queue never deadlocks', async () => {
    recomputeAndPersistMock.mockRejectedValue(new Error('pool exhausted'));

    // More users than slots: if a failing recompute leaked its slot, the tail
    // would hang forever. The scheduler swallows the error and releases in
    // `finally`, so all of them must still run.
    const COHORT = MAX_CONCURRENT_RECOMPUTES + 2;
    for (let i = 0; i < COHORT; i += 1) {
      scheduleScoreRecompute(`err-user-${i}`, 'checkin.morning.submitted', 'Europe/Paris');
    }

    await Promise.all(capturedAfterCallbacks.map((cb) => cb()));

    expect(recomputeAndPersistMock).toHaveBeenCalledTimes(COHORT);
  });
});

describe('MAX_CONCURRENT_RECOMPUTES — value anchor (J7 stress-test guard)', () => {
  it('pins the concurrency cap so a silent bump cannot slip through CI', () => {
    // This is a VALUE anchor, not a mechanism test. The tests above prove the
    // semaphore bounds concurrency to *whatever* MAX_CONCURRENT_RECOMPUTES is —
    // they stay green if someone bumps it from 3 to 30. This test fails on any
    // change to the value itself, forcing an explicit review + a re-run of the
    // k6 stress suite (ops/stress) before the pg pool budget assumptions
    // (~10 round-trips per recompute vs DATABASE_POOL_MAX floor 8) change.
    expect(MAX_CONCURRENT_RECOMPUTES).toBe(3);
  });
});
