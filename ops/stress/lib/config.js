// Shared configuration for the Fxmily k6 stress suite.
//
// Every value is env-overridable so the same scripts run against a local
// prod-like build without editing source. NOTHING secret is hard-coded here:
// CRON_SECRET / ADMIN_TOKEN / the uploader credentials must be passed at run
// time (see README.md). This file is committed to a PUBLIC repo.

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// ---- seeded cohort identity (must mirror scripts/seed-stress-cohort.ts) -----
// Seed emails look like: stress-cohort-0000.member.e2e.test@fxmily.local
export const MEMBER_EMAIL_PREFIX = __ENV.MEMBER_EMAIL_PREFIX || 'stress-cohort-';
export const MEMBER_EMAIL_SUFFIX = __ENV.MEMBER_EMAIL_SUFFIX || '.member.e2e.test@fxmily.local';
export const MEMBER_PASSWORD = __ENV.MEMBER_PASSWORD || 'stress-cohort-verify-only';
export const MEMBER_COUNT = Number(__ENV.MEMBER_COUNT || 1000);

/** Email of seeded member #i (wraps modulo MEMBER_COUNT). */
export function memberEmail(i) {
  const idx = String(((i % MEMBER_COUNT) + MEMBER_COUNT) % MEMBER_COUNT).padStart(4, '0');
  return `${MEMBER_EMAIL_PREFIX}${idx}${MEMBER_EMAIL_SUFFIX}`;
}

// ---- session cookie name ----------------------------------------------------
// Local http => 'authjs.session-token'. Behind https (prod) it becomes
// '__Secure-authjs.session-token'. We test LOCAL http, hence the default.
export const SESSION_COOKIE = __ENV.SESSION_COOKIE_NAME || 'authjs.session-token';

// ---- privileged-endpoint secrets (run-time only, NEVER committed) -----------
export const CRON_SECRET = __ENV.CRON_SECRET || '';
export const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

// ---- S2 uploader (an MT5-account holder — the seeded cohort has none) --------
export const UPLOAD_EMAIL = __ENV.UPLOAD_EMAIL || '';
export const UPLOAD_PASSWORD = __ENV.UPLOAD_PASSWORD || '';
export const UPLOAD_ACCOUNT_ID = __ENV.UPLOAD_ACCOUNT_ID || '';

// ---- per-scenario sizing (defaults = the J7 revue plan figures) -------------
export const S1 = { vus: Number(__ENV.S1_VUS || 100), loginPool: Number(__ENV.S1_POOL || 100) };
export const S2 = { vus: Number(__ENV.S2_VUS || 50) };
export const S3 = { vus: Number(__ENV.S3_VUS || 200), loginPool: Number(__ENV.S3_POOL || 200) };
export const S4 = {
  memberVus: Number(__ENV.S4_MEMBER_VUS || 50),
  loginPool: Number(__ENV.S4_POOL || 50),
};

// ---- shared thresholds ------------------------------------------------------
// p95 < 800ms on member-facing reads, < 1% failed (any 4xx/5xx counts as failed
// unless the scenario tags a request as an expected non-2xx).
export const READ_P95_MS = Number(__ENV.READ_P95_MS || 800);
