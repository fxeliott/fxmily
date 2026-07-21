// Auth.js v5 (credentials) login helper for k6.
//
// Flow: GET /api/auth/csrf -> POST /api/auth/callback/credentials (form-encoded)
// which sets the session cookie. We read the cookie value back out of the k6
// cookie jar and return it so callers can attach it statelessly per request
// (VUs then don't need to re-login every iteration).

import http from 'k6/http';
import { BASE_URL, SESSION_COOKIE } from './config.js';

/**
 * Log a member in. Returns the session-cookie value string, or null on failure.
 * Call from setup() to build a token pool shared across VUs.
 */
export function login(email, password, baseUrl = BASE_URL) {
  const csrfRes = http.get(`${baseUrl}/api/auth/csrf`, { tags: { name: 'auth_csrf' } });
  if (csrfRes.status !== 200) return null;
  const csrfToken = csrfRes.json('csrfToken');
  if (!csrfToken) return null;

  // json:'true' makes Auth.js answer 200 {url} instead of a 302; either way the
  // Set-Cookie lands in the jar. redirects:0 keeps us from chasing the redirect.
  http.post(
    `${baseUrl}/api/auth/callback/credentials`,
    { csrfToken, email, password, callbackUrl: baseUrl, json: 'true' },
    { redirects: 0, tags: { name: 'auth_callback' } },
  );

  const cookies = http.cookieJar().cookiesForURL(baseUrl);
  const arr = cookies[SESSION_COOKIE] || cookies['__Secure-authjs.session-token'];
  return arr && arr.length ? arr[0] : null;
}

/**
 * Build k6 request params that attach a session token as a cookie, merging any
 * extra params (tags, headers, timeout...).
 *
 * `redirects: 0` is the default so an authenticated read with an INVALID token
 * does NOT silently follow 307 → /login → 200 (a false green). With it, a broken
 * session surfaces as a 307, and scenario checks that assert `r.status === 200`
 * correctly fail instead of counting the /login page as a passing read. Callers
 * can still override via `extra` when they explicitly want to chase a redirect.
 */
export function authParams(token, extra) {
  return Object.assign(
    { redirects: 0, cookies: { [SESSION_COOKIE]: { value: token } } },
    extra || {},
  );
}
