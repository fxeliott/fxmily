import { describe, expect, it } from 'vitest';

import { TokenBucketLimiter } from './token-bucket';

/**
 * Token bucket rate limiter (J5 audit Security HIGH H2 fix).
 *
 * Pure unit tests — no DB / no network. We pass `now` explicitly so refill
 * timing is deterministic.
 */

describe('TokenBucketLimiter', () => {
  it('allows the first burst up to bucketSize', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 3, refillRate: 1 });
    expect(lim.consume('a').allowed).toBe(true);
    expect(lim.consume('a').allowed).toBe(true);
    expect(lim.consume('a').allowed).toBe(true);
    expect(lim.consume('a').allowed).toBe(false);
  });

  it('reports remaining tokens correctly', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 3, refillRate: 1 });
    expect(lim.consume('a').remaining).toBe(2);
    expect(lim.consume('a').remaining).toBe(1);
    expect(lim.consume('a').remaining).toBe(0);
  });

  it('hands out a sensible retryAfterMs when empty', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 1 });
    const now = 1_000_000;
    expect(lim.consume('a', now).allowed).toBe(true);
    const denied = lim.consume('a', now);
    expect(denied.allowed).toBe(false);
    // Refill rate 1/sec, need 1 token → ~1000ms wait.
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(900);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1100);
  });

  it('refills proportionally to elapsed time', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 5, refillRate: 1 });
    const t0 = 0;
    // Drain.
    for (let i = 0; i < 5; i++) expect(lim.consume('a', t0).allowed).toBe(true);
    expect(lim.consume('a', t0).allowed).toBe(false);
    // 3 seconds later → 3 tokens regenerated.
    const t3 = t0 + 3_000;
    expect(lim.consume('a', t3).allowed).toBe(true);
    expect(lim.consume('a', t3).allowed).toBe(true);
    expect(lim.consume('a', t3).allowed).toBe(true);
    expect(lim.consume('a', t3).allowed).toBe(false);
  });

  it('caps refill at bucketSize (no over-refill after long quiet)', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 3, refillRate: 10 });
    const t0 = 0;
    expect(lim.consume('a', t0).allowed).toBe(true); // 2 left
    // 1 hour later — refill would be 36 000 tokens but bucket caps at 3.
    const t1h = t0 + 60 * 60 * 1000;
    expect(lim.consume('a', t1h).allowed).toBe(true); // 2 left after consume
    expect(lim.consume('a', t1h).allowed).toBe(true); // 1 left
    expect(lim.consume('a', t1h).allowed).toBe(true); // 0 left
    expect(lim.consume('a', t1h).allowed).toBe(false);
  });

  it('isolates buckets per key', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 1 });
    expect(lim.consume('a').allowed).toBe(true);
    // a is empty, b is fresh.
    expect(lim.consume('a').allowed).toBe(false);
    expect(lim.consume('b').allowed).toBe(true);
  });

  it('evicts oldest keys past maxKeys cap (LRU)', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 1, maxKeys: 2 });
    expect(lim.consume('a').allowed).toBe(true);
    expect(lim.consume('b').allowed).toBe(true);
    // adding a third key evicts 'a' (oldest).
    expect(lim.consume('c').allowed).toBe(true);
    // 'a' should now have a fresh bucket — its prior consume was evicted.
    expect(lim.consume('a').allowed).toBe(true);
    // size stays at maxKeys.
    expect(lim.size).toBeLessThanOrEqual(2);
  });

  it('promotes recently-accessed keys (LRU)', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 1, maxKeys: 2 });
    // Insert in order a, b.
    lim.consume('a');
    lim.consume('b');
    // Touch a — promotes it. Now b is oldest.
    lim.consume('a');
    // Adding c evicts b, not a.
    lim.consume('c');
    // a still rate-limited (bucket was empty).
    expect(lim.consume('a').allowed).toBe(false);
    // b is fresh.
    expect(lim.consume('b').allowed).toBe(true);
  });

  it('treats fractional refill correctly across multiple consumes', () => {
    // refillRate 0.5/sec → 1 token every 2 sec.
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 0.5 });
    expect(lim.consume('a', 0).allowed).toBe(true);
    expect(lim.consume('a', 1_000).allowed).toBe(false); // only 0.5 token after 1s
    expect(lim.consume('a', 2_000).allowed).toBe(true); // exactly 1 token after 2s
  });

  it('handles backwards-clock-drift gracefully (no negative refill)', () => {
    const lim = new TokenBucketLimiter({ bucketSize: 1, refillRate: 1 });
    expect(lim.consume('a', 1_000).allowed).toBe(true);
    // Imagine NTP rewinds by 5s. Refill clamp to >= 0 means we just don't
    // refill, never negative.
    expect(lim.consume('a', 500).allowed).toBe(false);
  });
});
