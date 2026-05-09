import { describe, expect, it } from 'vitest';

import { loginEmailLimiter, loginIpLimiter, TokenBucketLimiter } from './token-bucket';

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

/**
 * Phase T (2026-05-09) — Login bruteforce defense singletons.
 *
 * Both limiters are module-level singletons whose state persists across
 * tests in this file. To stay isolated we always pass unique keys (prefixed
 * with the test name) so a flaky earlier test can never deplete a bucket
 * we expect to be fresh, and we always pass an explicit `now` so refill
 * timing is deterministic.
 */

describe('loginEmailLimiter (Phase T singleton)', () => {
  // Why this matters : the bucket sizing is a tradeoff between locking out
  // a typo-prone Eliot vs. throttling a dictionary attack. SPEC §9.2 +
  // token-bucket.ts comment pin 5 burst, 1/min refill. A regression that
  // bumps these to 50/100 would silently disable the defense.
  it('is configured with bucketSize 5 and refillRate 1/60 (5 burst, 1/min)', () => {
    // Drain a fresh bucket : we MUST be allowed exactly 5 consecutive
    // consumes from a never-seen-before key, then the 6th must trip.
    const key = 'config-burst@test.local';
    const t0 = 0;
    for (let i = 0; i < 5; i++) {
      expect(loginEmailLimiter.consume(key, t0).allowed).toBe(true);
    }
    expect(loginEmailLimiter.consume(key, t0).allowed).toBe(false);

    // Refill rate 1/60 token/sec → 1 token every 60s. After 60s exactly
    // we should have +1 token available again.
    const denied = loginEmailLimiter.consume(key, t0);
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(59_000);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(61_000);
  });

  // Why this matters : the comment block on the limiter explicitly
  // promises "5 burst + 1 over → trip on the 6th". This test is the
  // executable spec.
  it('trips on the 6th consecutive consume (5 burst + 1 over)', () => {
    const key = 'sixth-trip@test.local';
    const t0 = 1_000_000;
    const decisions = Array.from({ length: 6 }, () => loginEmailLimiter.consume(key, t0));

    expect(decisions.slice(0, 5).every((d) => d.allowed)).toBe(true);
    expect(decisions[5]?.allowed).toBe(false);
    expect(decisions[5]?.remaining).toBe(0);
    expect(decisions[5]?.retryAfterMs).toBeGreaterThan(0);
  });

  // Why this matters : after a full drain a member who waits 60s should
  // get exactly 1 token back (per `refillRate: 1/60` = 1 token/min). This
  // is the "self-recovery" promise — without it a typo would lock the
  // account for hours.
  it('refills 1 token after exactly 60s', () => {
    const key = 'refill-60s@test.local';
    const t0 = 2_000_000;
    // Drain 5 tokens.
    for (let i = 0; i < 5; i++) loginEmailLimiter.consume(key, t0);
    expect(loginEmailLimiter.consume(key, t0).allowed).toBe(false);

    // 60 seconds later → exactly 1 token regenerated.
    const t60 = t0 + 60_000;
    expect(loginEmailLimiter.consume(key, t60).allowed).toBe(true);
    // The bucket is empty again immediately after.
    expect(loginEmailLimiter.consume(key, t60).allowed).toBe(false);
  });
});

describe('loginIpLimiter (Phase T singleton)', () => {
  // Why this matters : per-IP allows 10 burst (twice the per-email budget)
  // because households / NATed offices can legitimately fan out to many
  // accounts. Going below 10 would lock co-workers out of an office IP.
  it('is configured with bucketSize 10 and refillRate 1/60 (10 burst, 1/min)', () => {
    const key = 'config-burst-ip-203.0.113.42';
    const t0 = 0;
    for (let i = 0; i < 10; i++) {
      expect(loginIpLimiter.consume(key, t0).allowed).toBe(true);
    }
    expect(loginIpLimiter.consume(key, t0).allowed).toBe(false);

    const denied = loginIpLimiter.consume(key, t0);
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(59_000);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(61_000);
  });

  // Why this matters : the IP limiter trips on the 11th attempt, not the
  // 10th. A regression that off-by-ones to bucketSize: 9 would shave 10%
  // off the burst budget and break legitimate office traffic.
  it('trips on the 11th consecutive consume (10 burst + 1 over)', () => {
    const key = 'eleventh-trip-ip-203.0.113.99';
    const t0 = 3_000_000;
    const decisions = Array.from({ length: 11 }, () => loginIpLimiter.consume(key, t0));

    expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
    expect(decisions[10]?.allowed).toBe(false);
    expect(decisions[10]?.remaining).toBe(0);
  });

  // Why this matters : same self-recovery promise as the email limiter.
  // 60s → +1 token. Critical for an attacker that backs off vs. a
  // legitimate caller who hit the cap by accident.
  it('refills 1 token after exactly 60s', () => {
    const key = 'refill-60s-ip-203.0.113.7';
    const t0 = 4_000_000;
    for (let i = 0; i < 10; i++) loginIpLimiter.consume(key, t0);
    expect(loginIpLimiter.consume(key, t0).allowed).toBe(false);

    const t60 = t0 + 60_000;
    expect(loginIpLimiter.consume(key, t60).allowed).toBe(true);
    expect(loginIpLimiter.consume(key, t60).allowed).toBe(false);
  });
});
