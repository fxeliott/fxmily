import { describe, expect, it } from 'vitest';

import { TokenBucketLimiter } from '@/lib/rate-limit/token-bucket';

import { nextSyntheticCallerIp } from './e2e-auth';

/**
 * Regression guard for the deterministic e2e.yml auth failure.
 *
 * Symptom (pre-fix): `e2e.yml` was RED on `main`. Three specs
 * (`v1-8-reflect-happy-path:267`, `wizard-v1-5-fields:167`+`:210`) failed
 * deterministically at `loginAs` with
 * `no session cookie found after credentials callback`, preceded by
 * repeated `[auth][error] CredentialsSignin` — but only LATE in the run,
 * while earlier specs using the same helper passed, and it survived
 * Playwright's ×2 retries.
 *
 * Root cause: the production Credentials `authorize()` consumes
 * `loginIpLimiter` (burst 10, refill 1 token / 60 s) keyed by
 * `callerIdTrusted()`. Under `next dev` in CI there is no Caddy and no
 * `x-forwarded-for` / `x-real-ip`, so `callerIdTrusted()` returns the
 * literal key `'unknown'` for EVERY request. The whole 46-spec suite then
 * shares one bucket: after ~10 cumulative logins it is drained, refill is
 * far too slow (1/min) to recover between specs, and every later login
 * gets `authorize() === null` → `CredentialsSignin` → no session cookie.
 *
 * Fix: `loginAs` now stamps a unique synthetic `x-forwarded-for` per call
 * (`nextSyntheticCallerIp`), so each login lands in its own fresh bucket —
 * exactly as N real members on N real IPs would. The limiter still runs on
 * every login; it is simply no longer artificially exhausted by the
 * harness collapsing to one origin.
 *
 * These tests reproduce the limiter mechanics with the EXACT production
 * `loginIpLimiter` shape and assert: (a) the old shared-key behavior trips
 * mid-suite, (b) the new per-call IPs never trip.
 */

// Mirror of the production `loginIpLimiter` config
// (`lib/rate-limit/token-bucket.ts:274`). A fresh instance per test so the
// module-level singleton state never bleeds in.
function freshLoginIpLimiter(): TokenBucketLimiter {
  return new TokenBucketLimiter({ bucketSize: 10, refillRate: 1 / 60, maxKeys: 5000 });
}

describe('nextSyntheticCallerIp', () => {
  // Why this matters: the fix relies on every call producing a DISTINCT
  // bucket key. A regression that returns a constant (or wraps cheaply)
  // would silently re-introduce the shared-bucket exhaustion.
  it('yields a unique, well-formed RFC1918 address on every call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const ip = nextSyntheticCallerIp();
      expect(ip).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      for (const octet of ip.split('.').slice(1)) {
        expect(Number(octet)).toBeGreaterThanOrEqual(0);
        expect(Number(octet)).toBeLessThanOrEqual(255);
      }
      expect(seen.has(ip)).toBe(false);
      seen.add(ip);
    }
    expect(seen.size).toBe(5000);
  });
});

describe('e2e loginAs rate-limit interaction (deterministic root-cause repro)', () => {
  // Why this matters: this is the executable reproduction of the bug. With
  // the pre-fix behavior (every login collapses to the single
  // `callerIdTrusted` key `'unknown'`), a serial suite that logs in more
  // than `bucketSize` times within a minute trips the limiter — and stays
  // tripped (refill is 1/min, retries happen in seconds). The 11th login
  // is the first to fail, which lines up with the observed "passes early,
  // fails late, sticky across retries" signature.
  it('OLD shared-key behavior: the 11th cumulative login is rejected (root cause)', () => {
    const lim = freshLoginIpLimiter();
    const now = 1_000_000; // frozen clock — no meaningful refill within a fast suite
    const SHARED_KEY = 'unknown'; // what callerIdTrusted() returns with no XFF / x-real-ip

    const decisions = Array.from({ length: 11 }, () => lim.consume(SHARED_KEY, now));

    expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
    expect(decisions[10]?.allowed).toBe(false);
    // And it STAYS rejected on the Playwright retry a few seconds later
    // (well under the 60s needed for a single token to refill).
    expect(lim.consume(SHARED_KEY, now + 3_000).allowed).toBe(false);
  });

  // Why this matters: this is the executable proof of the fix. Simulate a
  // suite far larger than the real one (60 logins ≫ the ~15 loginAs call
  // sites + retries) — with one synthetic IP per login, NONE are ever
  // rejected, because each lands in its own fresh burst-10 bucket.
  it('FIXED per-call IP: 60 sequential logins from distinct synthetic IPs never trip', () => {
    const lim = freshLoginIpLimiter();
    const now = 2_000_000; // frozen clock — prove it works with zero refill help

    for (let i = 0; i < 60; i++) {
      const ip = nextSyntheticCallerIp();
      expect(lim.consume(ip, now).allowed).toBe(true);
    }
  });

  // Why this matters: a single spec re-logging in as the same user (e.g.
  // wizard-v1-5-fields has two RENDER tests on one seeded email) plus
  // Playwright's ×2 retries must still stay under the burst budget. With a
  // unique IP per call this is trivially true even if every login retried
  // the maximum number of times.
  it('FIXED per-call IP: even a 3× retried login stays comfortably under burst 10', () => {
    const lim = freshLoginIpLimiter();
    const now = 3_000_000;
    // 5 specs × 1 login × (1 initial + 2 retries) = 15 logins, all distinct IPs.
    for (let i = 0; i < 15; i++) {
      expect(lim.consume(nextSyntheticCallerIp(), now).allowed).toBe(true);
    }
  });
});
