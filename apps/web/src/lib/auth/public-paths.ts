/**
 * Single source of truth for the app's PUBLIC route boundary.
 *
 * Two layers consume this and previously each kept their OWN copy, which
 * drifted (audit 2026-07-08: `/offline` public in auth but not in the shell
 * mirror; `/onboarding` vs `/onboarding/` prefix mismatch):
 *
 *  - `auth.config.ts` `authorized()` — the REAL security gate (edge proxy).
 *  - `components/nav/app-shell.tsx` — the cosmetic mirror (nav chrome on/off).
 *
 * Both now import `isPublic` from here, so a future public route added for
 * auth automatically renders chrome-less too — divergence is structurally
 * impossible. `public-paths.test.ts` additionally proves the real gate
 * (`authConfig.callbacks.authorized`) agrees with this function for anonymous
 * requests across a path matrix.
 *
 * MUST stay pure (no Node-only imports, no side effects): it runs in the edge
 * proxy AND in the client bundle.
 */

export const PUBLIC_PREFIXES = [
  '/onboarding/',
  '/reset-password',
  '/api/auth',
  '/legal',
  '/_next',
  '/favicon',
] as const;

// `/offline` (Tour 15) — the PWA offline fallback. It must be public so the
// service worker can pre-cache it at install (the fetch would 307→/login
// otherwise) and so an anonymous member who loses connectivity still sees the
// calm offline page instead of an auth redirect. Purely informational, no data.
// `/opengraph-image` (Tour 15) — link-preview crawlers (WhatsApp, X, Slack)
// never carry a session; runtime-proven 307→/login without this entry, which
// means NO link preview at all. Static brand image, no data.
export const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/forgot-password',
  '/rejoindre',
  '/offline',
  '/opengraph-image',
]);

/** True when `pathname` needs NO session (and renders without nav chrome). */
export function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}
