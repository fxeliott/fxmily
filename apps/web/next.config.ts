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
    ];
  },
};

export default nextConfig;
