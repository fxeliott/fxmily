import 'server-only';

/**
 * In-memory token bucket rate limiter (J5 audit Security HIGH H2 — TIER 4
 * follow-up).
 *
 * Single-instance V1 deployment on Hetzner — no Redis required. The bucket
 * map is bounded by an LRU cap so a flood of unique IPs can't OOM the
 * process. Wrap-around is acceptable: the worst case is that a long-quiet
 * client gets a fresh bucket on next request (lenient), never that another
 * client's bucket gets credited (strict).
 *
 * Algorithm: each bucket holds `bucketSize` tokens, refilled at
 * `refillRate` tokens/second. Each call to `consume(key)` removes 1 token
 * if available; otherwise rejects with a `retryAfterMs` hint.
 *
 * Migration path to Redis (J10 prod): swap `Map` for an Upstash redis
 * pipeline + Lua script that atomically refills + decrements. The
 * `consume()` signature stays identical so route handlers don't change.
 *
 * References: OneUptime (2026-01) Token Bucket guide ;
 *             freeCodeCamp (2026-01) Next.js in-memory rate limiter ;
 *             jhurliman/node-rate-limiter library shape.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining tokens after this consume (whole tokens, floored). */
  remaining: number;
  /** Milliseconds to wait before retrying. 0 when allowed. */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number; // ms epoch
}

interface TokenBucketOptions {
  /** Maximum tokens (burst capacity). */
  bucketSize: number;
  /** Tokens added per second. */
  refillRate: number;
  /** Max distinct keys to track. Older keys are evicted. Default 5000. */
  maxKeys?: number;
}

/**
 * LRU-capped Map. Reuses native Map insertion order (kept on `set` and
 * implicitly preserved by JS engines per spec). Promoting a key on access
 * means delete + set — cheap for the workloads we care about.
 */
class LruMap<K, V> {
  private readonly cap: number;
  private readonly map = new Map<K, V>();

  constructor(cap: number) {
    this.cap = cap;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.cap) {
      // Evict oldest.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

export class TokenBucketLimiter {
  private readonly bucketSize: number;
  private readonly refillRate: number;
  private readonly buckets: LruMap<string, Bucket>;

  constructor(options: TokenBucketOptions) {
    this.bucketSize = options.bucketSize;
    this.refillRate = options.refillRate;
    this.buckets = new LruMap(options.maxKeys ?? 5000);
  }

  /**
   * Attempt to consume 1 token from the `key`'s bucket. Returns the
   * decision + retry hint.
   *
   * Always returns synchronously; never throws (a broken rate limiter must
   * never become a self-DoS — fail-open philosophy from the OneUptime guide).
   */
  consume(key: string, now = Date.now()): RateLimitDecision {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.bucketSize, lastRefill: now };
    }

    // Refill phase.
    const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(this.bucketSize, bucket.tokens + elapsedSec * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    // Out of tokens — compute retry-after.
    const tokensNeeded = 1 - bucket.tokens;
    const waitSec = tokensNeeded / this.refillRate;
    this.buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(waitSec * 1000) };
  }

  /** For diagnostics / tests. */
  get size(): number {
    return this.buckets.size;
  }
}

// =============================================================================
// Singletons (one bucket per protected surface)
// =============================================================================

/**
 * Cron endpoint — burst 5, refill 1/min. Hetzner cron runs every 15 min in
 * prod; legitimate traffic is far below the burst budget. Throttles a
 * mis-configured retry loop or an attacker probing the secret.
 */
export const cronLimiter = new TokenBucketLimiter({
  bucketSize: 5,
  refillRate: 1 / 60,
  maxKeys: 1024,
});

/**
 * J10 Phase I — Per-user RGPD export endpoint (`/api/account/data/export`).
 *
 * `bucketSize: 3` lets a member retry twice if a download was interrupted
 * (network blip on a 5-10 s export at 1000+ trades). `refillRate: 1/(15*60)`
 * = 1 token every 15 minutes — enough to stop a logged-in attacker from
 * spamming exports to drive up DB load + R2 egress. The bucket is keyed
 * by `userId` ; aggregate fan-out across the whole cohort stays bounded
 * because each user has their own bucket.
 *
 * `maxKeys: 5000` matches the LruMap default ; at 30 → 1000 active members
 * we never come close.
 */
export const exportLimiter = new TokenBucketLimiter({
  bucketSize: 3,
  refillRate: 1 / (15 * 60),
});

/**
 * J10 Phase I — Sentry tunnel route (`/monitoring`).
 *
 * **Reserved for V2** (J10 Phase O review B2 correction). The original
 * intent was to guard the `withSentryConfig({ tunnelRoute: '/monitoring' })`
 * plugin-generated route, but the plugin doesn't expose a hook to call a
 * limiter before the Sentry forward. To actually wire this, V2 needs to
 * implement a custom `app/monitoring/route.ts` that consumes the limiter
 * then proxies to Sentry's ingest endpoint manually. Today we rely on
 * Sentry's edge-side spike protection (90 req/s per project hard cap) +
 * DSN-level access control. The limiter export below is kept as a stub
 * so the V2 wiring can pick it up without re-deriving the bucket sizing.
 *
 * Bucket sizing rationale (when wired) : burst of 50 envelopes per IP
 * for a typical session-replay flush, 1 envelope / sec sustained.
 */
export const sentryTunnelLimiter = new TokenBucketLimiter({
  bucketSize: 50,
  refillRate: 1, // 1 envelope/sec sustained
  maxKeys: 2048,
});

// =============================================================================
// Helpers — extract a stable per-caller identity from the request
// =============================================================================

/**
 * Best-effort caller identifier from a Next.js request. Prefers
 * `x-forwarded-for` (Caddy / Hetzner forward), falls back to `x-real-ip`,
 * finally to the literal string `'unknown'` so cross-instance noise still
 * shares one bucket.
 *
 * NEVER persisted, never logged in plaintext (use `hashIp` from
 * `lib/auth/audit.ts` if you need the value in audit logs).
 */
export function callerId(req: Request | { headers: Headers }): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
