import type { NextConfig } from 'next';

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
    "connect-src 'self'",
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

export default nextConfig;
