/**
 * In-memory token bucket rate limiter (J5 audit Security HIGH H2 — TIER 4
 * follow-up).
 *
 * ⚠️ NO `import 'server-only'` HERE — this is the marker-free core so that
 * `src/proxy.ts` (the Next.js 16 middleware bundle) can consume
 * `sentryTunnelLimiter` + `callerIdTrusted` without evaluating the
 * `server-only` package (whose `default` export condition throws at import
 * time; whether the proxy bundle resolves the `react-server` no-op condition
 * is bundler-dependent, so we don't gamble the whole middleware on it).
 * App code must keep importing from `./token-bucket`, which re-exports this
 * module behind the `server-only` guard.
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
 * Session 3 hardening — `/api/uploads` POST per-member bucket.
 *
 * Each 8 MiB image is buffered in memory then written to storage; the route
 * had no rate-limit, so a logged-in member could loop uploads unbounded
 * (disk/R2 cost + memory pressure). Keyed by `userId` — one bucket per
 * member, aggregate fan-out bounded by the cohort size.
 *
 * `bucketSize: 30` is generous for the heaviest legitimate session (log
 * several trades, each with an entry + exit capture, plus a few drag-drop
 * replacements/retries). `refillRate: 1/3` = one token every 3 s (~20/min
 * sustained) — far above any human cadence, tight enough to cap a flood
 * loop. The 429 is returned BEFORE `req.formData()` so the 8 MiB body is
 * never buffered for a throttled caller.
 */
export const uploadLimiter = new TokenBucketLimiter({
  bucketSize: 30,
  refillRate: 1 / 3,
});

/**
 * J10 Phase I — Sentry tunnel route (`/monitoring`).
 *
 * **WIRED (P2 quick-win, 2026-07-11)** in `src/proxy.ts`. The
 * `withSentryConfig({ tunnelRoute: '/monitoring' })` plugin rewrite doesn't
 * expose a hook, so the proxy intercepts `/monitoring[/*]` BEFORE the
 * rewrite runs: it consumes this limiter keyed by `callerIdTrusted(req)`
 * (last XFF hop — non-spoofable behind Caddy V1.12 P1) and answers
 * `429 + Retry-After` when the bucket is dry; allowed requests fall through
 * to the Sentry rewrite via `NextResponse.next()`. Defense in depth on top
 * of Sentry's edge-side spike protection (90 req/s per project hard cap) +
 * DSN-level access control.
 *
 * Bucket sizing rationale : burst of 50 envelopes per IP for a typical
 * session-replay flush, 1 envelope / sec sustained.
 */
export const sentryTunnelLimiter = new TokenBucketLimiter({
  bucketSize: 50,
  refillRate: 1, // 1 envelope/sec sustained
  maxKeys: 2048,
});

/**
 * V1.7.2 — `/api/admin/weekly-batch/{pull,persist}` per-IP bucket.
 *
 * Eliott triggers the batch from his local machine ; legitimate flow = 1 pull
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
 * V1.4 §25 — `/api/admin/monthly-batch/{pull,persist}` per-IP bucket.
 *
 * Carbon of `adminBatchLimiter` (weekly). Eliott triggers the monthly batch
 * from his local machine ; legitimate flow = 1 pull + 1 persist per month.
 * Same burst 10 / refill 1-per-5-min envelope as the weekly batch — well
 * below any human cadence, tight enough to throttle a bot brute-forcing the
 * 32-char `MONTHLY_ADMIN_BATCH_TOKEN`. Separate singleton (not shared with
 * `adminBatchLimiter`) so a weekly-batch flood never locks out the monthly
 * batch and vice-versa — independent surfaces, independent buckets.
 */
export const monthlyBatchLimiter = new TokenBucketLimiter({
  bucketSize: 10,
  refillRate: 1 / (5 * 60),
  maxKeys: 256,
});

/**
 * §26 — `/api/admin/calendar-batch/{pull,persist}` per-IP bucket (J-C2).
 *
 * Carbon of `monthlyBatchLimiter`. Eliott triggers the calendar batch from his
 * local machine ; legitimate flow = 1 pull + 1 persist per week. Same burst 10
 * / refill 1-per-5-min envelope — well below any human cadence, tight enough to
 * throttle a bot brute-forcing the 32-char `CALENDAR_ADMIN_BATCH_TOKEN`.
 * Separate singleton (not shared with the weekly/monthly buckets) so a flood on
 * one batch surface never locks Eliott out of another — independent surfaces,
 * independent buckets.
 */
export const calendarBatchLimiter = new TokenBucketLimiter({
  bucketSize: 10,
  refillRate: 1 / (5 * 60),
  maxKeys: 256,
});

/**
 * S3 §33.4 — `/api/admin/verification-batch/*` per-IP bucket (vision MT5).
 *
 * Carbon of `calendarBatchLimiter` with a LARGER burst: the legitimate flow
 * is 1 pull + N proof-image downloads + 1 persist per run (one download per
 * pending proof, sequential). Burst 40 covers a 25-proof batch + retries;
 * refill 1-per-minute keeps a stolen-token bot far below useful throughput
 * while never throttling Eliott's sequential script. Separate singleton so a
 * flood on another batch surface never locks out the verification batch.
 */
export const verificationBatchLimiter = new TokenBucketLimiter({
  bucketSize: 40,
  refillRate: 1 / 60,
  maxKeys: 256,
});

/**
 * Réunion hub (séances) J4 — `/api/admin/seances-batch/{pull,persist}` per-IP
 * bucket (6th local Claude pipeline: Zoom→Vimeo→Fathom→IA bornée).
 *
 * Carbon of `calendarBatchLimiter`. Eliott triggers the séance batch from his
 * local pipeline machine; legitimate flow = 1 pull + 1 persist per held session
 * (≤2/day: analyse@12h + debrief@20h). Same burst 10 / refill 1-per-5-min
 * envelope — well below any human cadence, tight enough to throttle a bot
 * brute-forcing the 32-char `SEANCES_ADMIN_BATCH_TOKEN`. Separate singleton (not
 * shared with the weekly/monthly/calendar/verification buckets) so a flood on
 * one batch surface never locks Eliott out of another — independent surfaces,
 * independent buckets.
 */
export const seancesBatchLimiter = new TokenBucketLimiter({
  bucketSize: 10,
  refillRate: 1 / (5 * 60),
  maxKeys: 256,
});

/**
 * J-E (expansion IA §21.5) — `/api/admin/member-profile-batch/{pull,persist}`
 * per-IP bucket (7th local Claude pipeline: monthly deep re-profiling, ADMIN-
 * ONLY).
 *
 * Carbon of `seancesBatchLimiter`. Eliott triggers this batch from his local
 * machine ~1×/month (1 pull + 1 persist). Same burst 10 / refill 1-per-5-min
 * envelope — well below any human cadence, tight enough to throttle a bot
 * brute-forcing the 32-char `PROFILE_ADMIN_BATCH_TOKEN`. Separate singleton so a
 * flood on one batch surface never locks Eliott out of another.
 */
export const profileBatchLimiter = new TokenBucketLimiter({
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
 * `bucketSize: 5/10` is generous enough that a typo-prone Eliott won't lock
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

/**
 * V2.5 — Public `/rejoindre` self-service access request (per-IP).
 *
 * Consumed PRE-AUTH (the form is unauthenticated) so the IP MUST be derived
 * with `callerIdTrusted` (last-entry XFF from Caddy — non-spoofable), NOT
 * `callerId` (first-entry, client-controlled). See the `callerIdTrusted`
 * warning above.
 *
 * `bucketSize: 3` lets a genuine visitor retry a couple of times (typo on the
 * email, network blip) without locking out; `refillRate: 1/(15*60)` = 1 token
 * every 15 minutes throttles a bot spraying join requests to flood the admin
 * pending queue + accumulate non-member PII (RGPD). Mirrors `exportLimiter`'s
 * burst-3 / 15-min-refill envelope. `maxKeys: 5000` matches the LruMap default
 * — far above any plausible legit cohort fan-out for a closed-cohort product.
 */
export const accessRequestIpLimiter = new TokenBucketLimiter({
  bucketSize: 3,
  refillRate: 1 / (15 * 60),
  maxKeys: 5000,
});

/**
 * "Mot de passe oublié" request (SPEC §7.1). Two buckets, both consumed
 * PRE-AUTH so the IP MUST come from `callerIdTrusted` (last-entry XFF), never
 * `callerId`.
 *
 * Per-EMAIL is the tight one: `bucketSize: 3` + `refillRate: 1/(15*60)` (1 per
 * 15 min) bounds how often a single inbox can be e-mailed a reset link — an
 * anti-abuse / anti-harassment cap (a stranger can't spam a victim's mailbox).
 * Per-IP is looser (`bucketSize: 5`, 1/min sustained) to absorb a genuine user
 * retrying, while throttling a bot enumerating addresses. Neither side reveals
 * which bucket tripped (anti-enumeration parity with the login limiter).
 */
export const passwordResetEmailLimiter = new TokenBucketLimiter({
  bucketSize: 3,
  refillRate: 1 / (15 * 60),
  maxKeys: 5000,
});

export const passwordResetIpLimiter = new TokenBucketLimiter({
  bucketSize: 5,
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
