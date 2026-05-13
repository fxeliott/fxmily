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

/**
 * V1.7.2 — `/api/admin/weekly-batch/{pull,persist}` per-IP bucket.
 *
 * Eliot triggers the batch from his local machine ; legitimate flow = 1 pull
 * + 1 persist per week (Sunday). Burst 10 covers `--resume` retries +
 * dev iteration without locking him out. Refill 1 token / 5 min sustained
 * is well below any human cadence but tight enough to throttle a bot
 * brute-forcing the 32-char token.
 *
 * The bucket key is the caller IP (Caddy `x-forwarded-for`) — single
 * cohort, single admin, low-cardinality. `maxKeys: 256` is generous.
 */
export const adminBatchLimiter = new TokenBucketLimiter({
  bucketSize: 10,
  refillRate: 1 / (5 * 60),
  maxKeys: 256,
});

/**
 * V1.6 extras — `/api/health` endpoint rate-limit.
 *
 * Pre-existing security HIGH identified by Round 5 security-auditor audit :
 * `/api/health` performs `SELECT 1` against the Prisma pool on every request,
 * unauthenticated, unlimited. An attacker could saturate the `max=10` pool
 * (V1.6 polish config) with ~11 concurrent requests and trigger
 * `connectionTimeoutMillis = 5_000` throws on every other route for 5s+.
 *
 * Per-IP bucket : burst 30 (kubelet probes + uptime monitors hit this
 * legitimately), refill 1/s sustained. Beyond the burst → 429 with
 * Retry-After. Caddy-side IP forwarding (`x-forwarded-for`) is honored via
 * `callerId()`.
 *
 * Why not just remove the DB ping ? : SPEC §12.4 requires `/api/health` to
 * report `checks.db === 'ok'` for the Hetzner readiness gate. Removing the
 * ping would hide a real DB-down condition. Rate-limit is the right answer.
 */
export const healthLimiter = new TokenBucketLimiter({
  bucketSize: 30,
  refillRate: 1,
  maxKeys: 4096,
});

/**
 * J10 Phase T (security promotion 2026-05-09) — Login bruteforce / credential
 * stuffing defense.
 *
 * Wraps `signInAction` in `app/login/actions.ts`. Two buckets are consumed
 * per login attempt:
 *   1. **per-email** : same email × 5 attempts max in the burst, then
 *      1 attempt per minute. Stops dictionary attacks on a known account.
 *   2. **per-IP**    : same caller IP × 10 attempts max in the burst, then
 *      1/min. Stops credential stuffing across many emails from one machine.
 *
 * If EITHER bucket trips, return `{ ok: false, error: 'rate_limited' }` with
 * the longer of the two `retryAfterMs`. We don't reveal which bucket was hit
 * (anti-enumeration). Audit row `auth.login.rate_limited` with metadata
 * `{ kind: 'email' | 'ip', retryAfterMs }` (no email in plaintext).
 *
 * `bucketSize: 5/10` is generous enough that a typo-prone Eliot won't lock
 * himself out, but tight enough that a bot doing 60 req/min still trips
 * after the 11th attempt.
 */
export const loginEmailLimiter = new TokenBucketLimiter({
  bucketSize: 5,
  refillRate: 1 / 60, // 1 token/min sustained
  maxKeys: 5000,
});

export const loginIpLimiter = new TokenBucketLimiter({
  bucketSize: 10,
  refillRate: 1 / 60,
  maxKeys: 5000,
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
 *
 * ⚠️ This reads the FIRST entry of `x-forwarded-for`, which is the entry
 * the *original client* set — spoofable by anyone. This is acceptable for
 * the consumers that gate on a strong secret BEFORE consuming the bucket
 * (cron routes — secret check first, bucket second), but NOT for surfaces
 * that consume the bucket pre-auth. Use `callerIdTrusted` for those.
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

/**
 * V1.7.2 — Trusted caller identifier from a Next.js request.
 *
 * Parses `x-forwarded-for` from the END of the chain. Caddy v2's default
 * `reverse_proxy` directive **appends** the immediate client IP to
 * `X-Forwarded-For` (rather than overriding). The LAST entry in the chain
 * is therefore the IP that Caddy itself observed — trustable, not
 * client-controlled.
 *
 * For surfaces that consume a rate-limit bucket BEFORE the auth gate (so
 * an unauthenticated caller can drain it), use this helper instead of
 * `callerId` to prevent XFF-spoofing bypass. Reference : security audit
 * R2 V1.7.2 finding HIGH 5.3 (`callerId` reads first entry = attacker-set).
 *
 * Falls back to `x-real-ip` (single-value, set by Caddy) then `'unknown'`.
 */
export function callerIdTrusted(req: Request | { headers: Headers }): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const segments = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
