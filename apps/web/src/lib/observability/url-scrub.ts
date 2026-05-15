/**
 * Shared URL/query-string sensitive-param scrubber for Sentry `beforeSend`.
 *
 * V1.11 — extracted from `sentry.server.config.ts` (J10 Phase G fix livré
 * 33% : server only) for symmetric application across the 3 runtimes
 * (server + client + edge). Round 4 sub-agent N finding : client + edge
 * `beforeSend` did not scrub URL/query_string → magic-link tokens
 * (`/onboarding/welcome?token=...`) could leak to Sentry SaaS on a JS
 * frontend error or Edge middleware throw.
 *
 * Pure functions, isomorphic Edge-compat (URL + URLSearchParams natifs
 * Web runtime). No `server-only` import — safe to load in client bundle.
 *
 * Allowlist whitelist applied :
 *   - `token` : invitation tokens, magic-link callbacks, CSRF tokens
 *   - `secret` : any kind of secret
 *   - `password` : URL-encoded password (rare but defensive)
 *   - `code` : OAuth code flow, magic-link verification codes
 *   - `key` : API keys, session keys
 *   - `signature` / `sig` : signed URLs, HMAC signatures
 */

export const SENSITIVE_PARAM_RE = /^(token|secret|password|code|key|signature|sig)$/i;

const FILTERED = '[Filtered]';
const PLACEHOLDER_ORIGIN = 'https://placeholder.invalid';

/**
 * Strip sensitive params from a raw query string. Accepts leading `?` or not.
 * Returns the scrubbed query string (no leading `?`) or the original input
 * if URLSearchParams fails to parse it (malformed → fail-open preserve).
 */
export function stripSensitiveQueryParams(qs: string): string {
  try {
    const search = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
    for (const k of Array.from(search.keys())) {
      if (SENSITIVE_PARAM_RE.test(k)) search.set(k, FILTERED);
    }
    return search.toString();
  } catch {
    return qs;
  }
}

/**
 * Strip sensitive params from a full URL (relative or absolute). Uses a
 * placeholder origin for relative URLs to satisfy the WHATWG URL parser,
 * then strips the placeholder back on return. Fail-open preserves the
 * original on parse failure.
 */
export function stripSensitiveUrlParams(url: string): string {
  try {
    const u = new URL(url, PLACEHOLDER_ORIGIN);
    for (const k of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_PARAM_RE.test(k)) u.searchParams.set(k, FILTERED);
    }
    return u.toString().replace(PLACEHOLDER_ORIGIN, '');
  } catch {
    return url;
  }
}
