import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

/**
 * Security headers — defense in depth on top of Caddy's HSTS / TLS termination.
 *
 * The CSP shipped here is intentionally a "good baseline" rather than a
 * nonce-based strict CSP. A strict CSP with nonces requires generating a fresh
 * nonce per request inside `proxy.ts` and threading it through layouts via
 * `headers()` — that refactor is scoped for the J10 production hardening pass.
 *
 * Until then, we accept `'unsafe-inline'` in `script-src` / `style-src` so
 * Next.js's framework runtime and Tailwind's injected styles work, and ban
 * everything else (frames, plugin objects, base hijacking, mixed content).
 */
function buildContentSecurityPolicy(isProd: boolean): string {
  // `'unsafe-eval'` is needed by Next.js dev tooling (RSC/HMR) and disabled in prod.
  const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // J10 — Sentry ingest. The browser SDK POSTs envelope payloads to the
    // DSN host. We accept any sentry.io subdomain (cluster + region tags
    // appear in the public DSN).
    "connect-src 'self' https://*.sentry.io",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(isProd) },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HSTS — prod only (otherwise it breaks local HTTP).
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // J10 — Docker production build. `output: 'standalone'` produces a self-
  // contained `.next/standalone/` directory with a minimal `node_modules/`
  // (only deps actually traced by the build), shrinking the prod image
  // from ~1.5 GB → ~250 MB and avoiding the need to copy `pnpm-lock.yaml`
  // into the runtime layer (no install step at boot).
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // J9 — Service Worker headers. The SW lives at `/sw.js` (public/sw.js).
      // - `Content-Type: application/javascript` is mandatory; some hosts
      //   default to `text/html` for unknown files which breaks registration.
      // - `Cache-Control: no-cache` forces the browser to revalidate the SW
      //   on every navigation. Combined with `updateViaCache: 'none'` in the
      //   client `register()` call, this guarantees push handler updates
      //   propagate within one tab reload — critical for incident response.
      // - `Service-Worker-Allowed: /` would only matter if we placed the
      //   script at a sub-path with a desired wider scope; with `public/sw.js`
      //   serving at `/sw.js` and `register({ scope: '/' })` matching, no
      //   header override is needed.
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

/**
 * Sentry plugin wrap (J10) — uploads source maps + tunnels Sentry traffic
 * through the same origin so an ad-blocker doesn't drop reports.
 *
 * The plugin is a no-op when `SENTRY_AUTH_TOKEN` / `SENTRY_DSN` are absent
 * (local dev), so the wrap is safe to ship unconditionally.
 */
export default withSentryConfig(nextConfig, {
  // Filled from `.env` / CI secrets — `org` and `project` slugs from the
  // Sentry project settings page.
  org: process.env.SENTRY_ORG ?? 'fxmily',
  project: process.env.SENTRY_PROJECT ?? 'fxmily-web',
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
  // Source-map handling :
  silent: !process.env.CI, // suppress non-CI noise locally
  widenClientFileUpload: true,
  sourcemaps: {
    // Hide the source maps from the user (the upload step still ships them
    // to Sentry; only the public chunks are stripped client-side).
    deleteSourcemapsAfterUpload: true,
  },
  disableLogger: true,
  // Tunnel `/monitoring` → Sentry ingest. Same-origin requests are not
  // blocked by privacy extensions / corporate firewalls.
  tunnelRoute: '/monitoring',
  // Don't fail the build if upload errors out (CI may have a flaky Sentry
  // gateway window).
  errorHandler: (err: Error) => {
    console.warn('[sentry] source maps upload failed (non-fatal):', err.message);
  },
});
