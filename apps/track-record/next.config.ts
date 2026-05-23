import type { NextConfig } from 'next';

/**
 * T0.5b — pivot Hetzner → Cloudflare Pages gratuit (Eliot 2026-05-22).
 *
 * `output: 'export'` génère du HTML/CSS/JS dans `out/`, servable sur le
 * CDN edge Cloudflare. C'est le mode canonique pour une vitrine 100%
 * statique sans backend runtime (cf. Cloudflare docs 2026 « Deploy a
 * static Next.js site »).
 *
 * Pas de `next-on-pages` (deprecated 2026) ni de Workers + OpenNext
 * (over-kill — pas de Server Actions / pas de Route Handlers runtime).
 *
 * `images: { unoptimized: true }` car le default loader Next/Image
 * nécessite un runtime serveur — incompatible export.
 *
 * Les headers de sécurité ne sont PAS définis ici : `headers()` est
 * unsupported en mode export. Ils vivent dans `public/_headers` que
 * Cloudflare Pages applique au CDN edge (et qui est plus puissant car
 * couvre toutes les routes statiques, pas juste celles Next).
 */
const nextConfig: NextConfig = {
  output: 'export',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
